/**
 * Save-time validation for flows.
 *
 * Run before activation (not on every draft save) — drafts are
 * intentionally allowed to be incomplete so users can save progress
 * mid-build. The builder calls these from BOTH client (so the user
 * sees issues live) and server (so a broken POST/PUT can't slip in
 * via direct API call).
 *
 * Three rule categories:
 *   1. Trigger sanity — keyword flows need keywords, etc.
 *   2. Graph integrity — entry node exists, all next_node_key
 *      references resolve, no unreachable nodes, non-terminal nodes
 *      have an outgoing edge.
 *   3. Meta API limits — button title ≤20 chars, ≤3 buttons per
 *      send_buttons, ≤10 list rows total, ≤24 chars per list row
 *      title. Mirrors the runtime checks inside
 *      `src/lib/whatsapp/meta-api.ts` so save-time and send-time
 *      can never disagree.
 *
 * Issues carry enough field info that the builder can highlight the
 * exact input that triggered them. Node-scoped issues include
 * `node_key`; trigger-scoped use `scope: 'trigger'`.
 *
 * Messages (migration 114) — all in pt-BR (CLAUDE.md: "UI: português
 * PT-BR obrigatório"). There is no i18n layer here (validate.ts is a
 * plain module shared by client live-validation and the server
 * activate route, called synchronously with no React/next-intl
 * context) — messages are plain pt-BR strings, same precedent as
 * `checkTimeoutWindowWarnings` below.
 */

import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";
import { SESSION_WINDOW_HOURS } from "@/lib/whatsapp/session-window";
import type { FlowTriggerType } from "./types";

// Node types `src/lib/flows/engine.ts` (conversational) doesn't
// implement — everything else in `workflow-engine.ts`'s vocabulary that
// is NOT in this set is a plain DB-write node also wired into the
// conversational executor (assign_conversation, update_deal_stage,
// mark_deal_lost, open_conversation), or (migration 114) start_flow,
// which the conversational engine implements with different (terminal)
// semantics than workflow-mode's fire-and-continue — see
// StartFlowNodeConfig in types.ts. Keep in sync with the `if
// (node.node_type === ...)` chain in engine.ts's advanceFromNodeKey.
// Exported so the two "Adicionar nó" menus (flow-builder.tsx,
// flow-canvas.tsx) can filter themselves to what the current flow's
// run_mode can actually execute instead of relying on activation-time
// validation to catch the mismatch after the fact.
export const CONVERSATIONAL_UNSUPPORTED_NODE_TYPES = new Set([
  "send_template",
  "wait",
  "randomizer",
  "stop_flow",
  "create_deal",
  "update_deal_value",
  "mark_deal_won",
  "unassign_agent",
  "update_contact_field",
  "set_conversation_pending",
  "close_conversation",
  "mark_as_read",
  "send_webhook",
]);

export interface ValidationIssue {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  /** Stable node_key the issue is attached to, when scope === 'node'. */
  node_key?: string;
  /** Dotted path to the bad field, e.g. 'buttons.0.title'. */
  field?: string;
  message: string;
}

// Trigger types the conversational engine's findEntryFlow() actually
// discriminates (see FlowTriggerConfig in src/lib/flows/types.ts).
// 'inactivity' only fires through the workflow engine's cron scan —
// same run_mode/trigger cross-check rationale as
// CONVERSATIONAL_UNSUPPORTED_NODE_TYPES below.
const CONVERSATIONAL_TRIGGER_TYPES = new Set([
  "keyword_match",
  "first_inbound_message",
  "manual",
]);

interface FlowInput {
  /**
   * Optional (migration 114) — only needed so `start_flow` nodes can
   * be checked for self-reference (`cfg.flow_id === flow.id`).
   * Callers that don't pass it just skip that specific check.
   */
  id?: string;
  name: string;
  trigger_type: FlowTriggerType;
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  /** Optional so existing callers/tests that don't pass it keep their
   *  current behavior (no run_mode/node_type cross-check). Callers
   *  that know the flow's run_mode should pass it. */
  run_mode?: "conversational" | "workflow";
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

/**
 * Minimal shape needed to check a `start_flow` node's target —
 * migration 114, item 3: "o fluxo de destino precisa estar ativo; se
 * não estiver, o validador avisa ao salvar." Optional parameter —
 * callers that don't have the account's flow list handy (or don't
 * care) simply skip this specific check; everything else in this
 * module stays fully synchronous/DB-free.
 */
export interface AvailableFlow {
  id: string;
  status: string;
  run_mode: "conversational" | "workflow";
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
  availableFlows?: AvailableFlow[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ---- name ----
  if (!flow.name || !flow.name.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "O nome do fluxo é obrigatório.",
    });
  }

  // ---- trigger ----
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));

  // ---- graph integrity ----
  if (!flow.entry_node_id) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: "Escolha um nó de entrada antes de ativar.",
    });
  }

  const keys = new Set(nodes.map((n) => n.node_key));
  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "Um fluxo precisa de pelo menos um nó antes de ser ativado.",
    });
  }

  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: `O nó de entrada "${flow.entry_node_id}" não existe.`,
    });
  }

  // Duplicate node_key (the DB UNIQUE constraint catches this on save
  // too, but surfacing it client-side gives a friendlier error path).
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.node_key)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: n.node_key,
        message: `node_key duplicado: "${n.node_key}".`,
      });
    }
    seen.add(n.node_key);
  }

  // Per-node rules (Meta limits + dead-end + edge resolution).
  for (const n of nodes) {
    issues.push(...validateNode(n, keys));
  }

  // run_mode/node_type cross-check — the node palette lets the builder
  // add any node type regardless of run_mode, but `src/lib/flows/engine.ts`
  // (the conversational executor) only implements a subset; the rest are
  // workflow-only (`src/lib/flows/workflow-engine.ts`). Without this check
  // a conversational flow could activate with a node its own engine can't
  // run and crash on the customer's first real trigger — see the
  // "VER ATUALIZAÇÃO" incident (58 failed runs / 57 customers over 4 days)
  // that motivated this check.
  if (flow.run_mode === "conversational") {
    for (const n of nodes) {
      if (!CONVERSATIONAL_UNSUPPORTED_NODE_TYPES.has(n.node_type)) continue;
      issues.push({
        severity: "error",
        scope: "node",
        node_key: n.node_key,
        message: `"${n.node_type}" é um tipo de nó exclusivo de fluxos de automação (workflow) e não é suportado em fluxos conversacionais.`,
      });
    }
    // Same mismatch, trigger side: 'inactivity' (and the rest of the
    // automations vocabulary) only ever fires via runFlowsForTrigger,
    // which filters on run_mode='workflow' — a conversational flow
    // saved with one of these would activate clean and then just never
    // run.
    if (!CONVERSATIONAL_TRIGGER_TYPES.has(flow.trigger_type)) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_type",
        message: `"${flow.trigger_type}" é um gatilho exclusivo de fluxos de automação (workflow) e não é suportado em fluxos conversacionais.`,
      });
    }
  }

  // Reachability — every non-orphan node must be reachable from the
  // entry. Done after per-node validation so we don't double-report
  // when a node has bad config AND is unreachable.
  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const n of nodes) {
      if (!reached.has(n.node_key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: n.node_key,
          message: `O nó "${n.node_key}" não é alcançável a partir do nó de entrada.`,
        });
      }
    }
  }

  // "No reply" branches that could outlive the 24h customer-service
  // window (migration 113, item 3).
  issues.push(...checkTimeoutWindowWarnings(nodes));

  // start_flow: self-reference (error) + target availability (warning)
  // — migration 114, items 2 and 3.
  issues.push(...checkStartFlowNodes(nodes, flow, availableFlows));

  return issues;
}

// ============================================================
// start_flow — self-reference + target-availability checks
// (migration 114).
// ============================================================

function checkStartFlowNodes(
  nodes: NodeInput[],
  flow: FlowInput,
  availableFlows?: AvailableFlow[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = availableFlows
    ? new Map(availableFlows.map((f) => [f.id, f]))
    : null;

  for (const n of nodes) {
    if (n.node_type !== "start_flow") continue;
    const cfg = n.config as { flow_id?: string };
    if (!cfg.flow_id) continue; // already flagged by validateNode below

    // Item 2 — never allow a flow to start itself; this alone doesn't
    // stop a LONGER cycle (A → B → A), which is why engine.ts's
    // runtime chain-limit guard (START_FLOW_CHAIN_LIMIT) exists too —
    // but the direct self-reference is always a configuration mistake
    // detectable at save time, so it's an error, not a warning.
    if (flow.id && cfg.flow_id === flow.id) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: n.node_key,
        field: "flow_id",
        message: '"Iniciar outro fluxo" não pode iniciar o próprio fluxo — isso criaria um loop.',
      });
      continue;
    }

    // Item 3 — target must be active. Only checked when the caller
    // supplied the account's flow list (both the server activate
    // route and the builder's live client-side validation do).
    if (!byId) continue;
    const target = byId.get(cfg.flow_id);
    if (!target) {
      issues.push({
        severity: "warning",
        scope: "node",
        node_key: n.node_key,
        field: "flow_id",
        message: 'O fluxo escolhido em "Iniciar outro fluxo" não foi encontrado — ele pode ter sido excluído.',
      });
    } else if (target.status !== "active") {
      issues.push({
        severity: "warning",
        scope: "node",
        node_key: n.node_key,
        field: "flow_id",
        message: 'O fluxo de destino de "Iniciar outro fluxo" não está ativo — ative-o, ou esta etapa não vai funcionar quando um cliente chegar até aqui.',
      });
    } else if (flow.run_mode === "conversational" && target.run_mode !== "conversational") {
      issues.push({
        severity: "warning",
        scope: "node",
        node_key: n.node_key,
        field: "flow_id",
        message: 'O fluxo de destino de "Iniciar outro fluxo" não é um fluxo conversacional — em fluxos conversacionais, só é possível iniciar outro fluxo conversacional.',
      });
    }
  }

  return issues;
}

// ============================================================
// Timeout-window warning — if the accumulated configured wait along
// a "no reply" (timeout) branch could reach/exceed the 24h Meta
// customer-service window (SESSION_WINDOW_HOURS, same constant the
// runtime session-window badge uses) before landing on a
// send_message/send_buttons/send_list node, that send would be
// outside the window and fail — only send_template works there. Warns
// (doesn't block activation — the elapsed time depends on when the
// customer last wrote in, which isn't knowable at save time) and
// suggests send_template.
// ============================================================

const HOURS_PER_UNIT: Record<"minutes" | "hours" | "days", number> = {
  minutes: 1 / 60,
  hours: 1,
  days: 24,
};

/**
 * This node's OWN configured wait, in hours — null when the node
 * isn't a timed wait, or its timeout is off. Used both as the
 * starting point (the origin's own deadline) and as the increment
 * added while walking past other timed nodes further down the "no
 * reply" branch.
 */
function configuredTimeoutHours(node: NodeInput): number | null {
  if (node.node_type === "wait") {
    const cfg = node.config as { amount?: number; unit?: "minutes" | "hours" | "days" };
    if (typeof cfg.amount !== "number" || !cfg.unit) return null;
    return cfg.amount * HOURS_PER_UNIT[cfg.unit];
  }
  if (node.node_type === "wait_for_reply") {
    const cfg = node.config as {
      timeout_enabled?: boolean;
      amount?: number;
      unit?: "minutes" | "hours" | "days";
    };
    if (cfg.timeout_enabled === false) return null;
    if (typeof cfg.amount !== "number" || !cfg.unit) return null;
    return cfg.amount * HOURS_PER_UNIT[cfg.unit];
  }
  if (node.node_type === "collect_input") {
    const cfg = node.config as {
      timeout_enabled?: boolean;
      timeout_amount?: number;
      timeout_unit?: "minutes" | "hours" | "days";
    };
    if (cfg.timeout_enabled !== true) return null;
    if (typeof cfg.timeout_amount !== "number" || !cfg.timeout_unit) return null;
    return cfg.timeout_amount * HOURS_PER_UNIT[cfg.timeout_unit];
  }
  return null;
}

/** The node_key this timed node resumes at if nobody replies — the
 *  branch this whole check walks. */
function timeoutTargetKey(node: NodeInput): string | null {
  if (node.node_type === "wait_for_reply" || node.node_type === "collect_input") {
    const cfg = node.config as { timeout_node_key?: string };
    return cfg.timeout_node_key ?? null;
  }
  return null;
}

function checkTimeoutWindowWarnings(nodes: NodeInput[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byKey = new Map<string, NodeInput>();
  for (const n of nodes) byKey.set(n.node_key, n);

  for (const origin of nodes) {
    if (origin.node_type !== "wait_for_reply" && origin.node_type !== "collect_input") {
      continue;
    }
    const startHours = configuredTimeoutHours(origin);
    const startKey = timeoutTargetKey(origin);
    if (startHours === null || !startKey || !byKey.has(startKey)) continue;

    // DFS from the "no reply" branch, summing each further timed
    // node's configured wait (worst case — see HOURS_PER_UNIT note
    // above), warning the first time a real send lands at/after 24h.
    // Bounded: `seen` keys on (node, rounded-up hour) so a cycle that
    // keeps accumulating hours still terminates once it's clearly
    // over the threshold either way.
    const warnedSends = new Set<string>();
    const seen = new Set<string>();
    const queue: Array<{ key: string; hours: number }> = [
      { key: startKey, hours: startHours },
    ];
    let guard = 0;
    while (queue.length > 0 && guard < 500) {
      guard += 1;
      const { key, hours } = queue.shift()!;
      const visitId = `${key}@${Math.min(Math.ceil(hours), SESSION_WINDOW_HOURS)}`;
      if (seen.has(visitId)) continue;
      seen.add(visitId);
      const node = byKey.get(key);
      if (!node) continue;

      if (
        (node.node_type === "send_message" ||
          node.node_type === "send_buttons" ||
          node.node_type === "send_list") &&
        hours >= SESSION_WINDOW_HOURS &&
        !warnedSends.has(node.node_key)
      ) {
        warnedSends.add(node.node_key);
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: node.node_key,
          message: `A espera acumulada no ramo "Sem resposta" (a partir do nó "${origin.node_key}") pode ultrapassar ${SESSION_WINDOW_HOURS}h antes deste envio, fora da janela de atendimento da Meta. Use "Enviar template" neste nó.`,
        });
      }

      const extra = configuredTimeoutHours(node) ?? 0;
      for (const next of outgoingEdges(node)) {
        queue.push({ key: next, hours: hours + extra });
      }
    }
  }

  return issues;
}

// ============================================================
// Trigger
// ============================================================

function validateTrigger(
  trigger_type: FlowInput["trigger_type"],
  trigger_config: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (trigger_type === "keyword_match") {
    const keywords = Array.isArray(trigger_config.keywords)
      ? (trigger_config.keywords as unknown[])
      : null;
    if (!keywords || keywords.length === 0) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.keywords",
        message: "Gatilhos por palavra-chave precisam de pelo menos uma palavra-chave.",
      });
    } else {
      // Empty / whitespace-only keywords are silent no-ops at match
      // time — call them out so the user doesn't think they configured
      // a keyword that never fires.
      const blanks = keywords.filter(
        (k) => typeof k !== "string" || !k.trim(),
      ).length;
      if (blanks > 0) {
        issues.push({
          severity: "warning",
          scope: "trigger",
          field: "trigger_config.keywords",
          message: `${blanks} palavra-chave${blanks === 1 ? "" : "s"} em branco — ${blanks === 1 ? "ela não vai" : "elas não vão"} corresponder a nada.`,
        });
      }
    }
  }
  if (trigger_type === "inactivity") {
    const hours = trigger_config.hours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.hours",
        message: "Gatilhos de inatividade precisam de um número positivo de horas.",
      });
    }
  }
  // first_inbound_message / manual have no config; nothing to validate.

  return issues;
}

// ============================================================
// Per-node
// ============================================================

/** pt-BR labels for the handful of "plain DB-write, single next
 *  node" types whose message used to interpolate the raw node_type. */
const GENERIC_NODE_LABELS: Record<string, string> = {
  unassign_agent: "Remover atendente",
  open_conversation: "Abrir conversa",
  set_conversation_pending: "Marcar conversa como pendente",
  close_conversation: "Encerrar conversa",
  mark_as_read: "Marcar como lida",
};

function validateNode(
  node: NodeInput,
  knownKeys: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  switch (node.node_type) {
    case "start": {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "O nó de início precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `O início aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_message": {
      const cfg = node.config as { text?: string; next_node_key?: string };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "O nó Enviar mensagem precisa de um texto.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "O nó Enviar mensagem precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Enviar mensagem aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_media": {
      const cfg = node.config as {
        media_type?: "image" | "video" | "document";
        media_url?: string;
        caption?: string;
        next_node_key?: string;
      };
      if (
        !cfg.media_type ||
        !["image", "video", "document"].includes(cfg.media_type)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "media_type",
          message: "O nó Enviar mídia precisa de um tipo de mídia (imagem, vídeo ou documento).",
        });
      }
      if (!cfg.media_url?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "media_url",
          message: "O nó Enviar mídia precisa de um arquivo (envie um antes de ativar).",
        });
      }
      // Caption cap mirrors Meta's interactive body cap; documented as a
      // hard limit in the WhatsApp Cloud API media-message reference.
      if (cfg.caption && cfg.caption.length > INTERACTIVE_LIMITS.bodyMaxLength) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "caption",
          message: `A legenda excede ${INTERACTIVE_LIMITS.bodyMaxLength} caracteres (limite do WhatsApp).`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "O nó Enviar mídia precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Enviar mídia aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_template": {
      const cfg = node.config as {
        template_name?: string;
        next_node_key?: string;
      };
      if (!cfg.template_name?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "template_name",
          message: "O nó Enviar template precisa de um template aprovado selecionado.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "O nó Enviar template precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Enviar template aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_buttons": {
      const cfg = node.config as {
        text?: string;
        buttons?: Array<{
          reply_id?: string;
          title?: string;
          next_node_key?: string;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "O nó Enviar botões precisa de um texto.",
        });
      }
      const btns = cfg.buttons ?? [];
      if (btns.length < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: "Enviar botões precisa de pelo menos um botão.",
        });
      }
      if (btns.length > INTERACTIVE_LIMITS.maxButtons) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: `O WhatsApp permite no máximo ${INTERACTIVE_LIMITS.maxButtons} botões por mensagem.`,
        });
      }
      const seenIds = new Set<string>();
      btns.forEach((b, i) => {
        const field = `buttons.${i}`;
        if (!b.reply_id?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `O botão ${i + 1} precisa de um reply id.`,
          });
        } else if (seenIds.has(b.reply_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `reply id de botão duplicado: "${b.reply_id}".`,
          });
        }
        if (b.reply_id) seenIds.add(b.reply_id);

        if (!b.title?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `O botão ${i + 1} precisa de um título.`,
          });
        } else if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `O título do botão ${i + 1} passa de ${INTERACTIVE_LIMITS.buttonTitleMaxLength} caracteres (limite do WhatsApp).`,
          });
        }

        if (!b.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `O botão ${i + 1} precisa de um próximo nó.`,
          });
        } else if (!knownKeys.has(b.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `O botão ${i + 1} aponta para um nó inexistente: "${b.next_node_key}".`,
          });
        }
      });
      break;
    }

    case "send_list": {
      const cfg = node.config as {
        text?: string;
        button_label?: string;
        sections?: Array<{
          title?: string;
          rows?: Array<{
            reply_id?: string;
            title?: string;
            description?: string;
            next_node_key?: string;
          }>;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "O nó Enviar lista precisa de um texto.",
        });
      }
      if (!cfg.button_label?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "button_label",
          message: "Enviar lista precisa de um rótulo de botão (o texto para expandir).",
        });
      }
      const sections = cfg.sections ?? [];
      const totalRows = sections.reduce(
        (sum, s) => sum + (s.rows?.length ?? 0),
        0,
      );
      if (totalRows < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: "Enviar lista precisa de pelo menos uma linha.",
        });
      }
      if (totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: `Enviar lista permite no máximo ${INTERACTIVE_LIMITS.maxListRowsTotal} linhas no total entre as seções.`,
        });
      }
      const seenIds = new Set<string>();
      sections.forEach((section, si) => {
        const rows = section.rows ?? [];
        rows.forEach((row, ri) => {
          const field = `sections.${si}.rows.${ri}`;
          if (!row.reply_id?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `A linha ${ri + 1} da seção ${si + 1} precisa de um reply id.`,
            });
          } else if (seenIds.has(row.reply_id)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `reply id de linha duplicado: "${row.reply_id}".`,
            });
          }
          if (row.reply_id) seenIds.add(row.reply_id);

          if (!row.title?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `A linha ${ri + 1} precisa de um título.`,
            });
          } else if (
            row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `O título da linha ${ri + 1} excede ${INTERACTIVE_LIMITS.listRowTitleMaxLength} caracteres.`,
            });
          }
          if (
            row.description &&
            row.description.length >
              INTERACTIVE_LIMITS.listRowDescriptionMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.description`,
              message: `A descrição da linha ${ri + 1} excede ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} caracteres.`,
            });
          }
          if (!row.next_node_key) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `A linha ${ri + 1} precisa de um próximo nó.`,
            });
          } else if (!knownKeys.has(row.next_node_key)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `A linha ${ri + 1} aponta para um nó inexistente: "${row.next_node_key}".`,
            });
          }
        });
      });
      break;
    }

    case "collect_input": {
      const cfg = node.config as {
        prompt_text?: string;
        var_key?: string;
        next_node_key?: string;
        timeout_enabled?: boolean;
        timeout_amount?: number;
        timeout_unit?: "minutes" | "hours" | "days";
        timeout_node_key?: string;
        timeout_max_resends?: number;
      };
      if (!cfg.prompt_text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "prompt_text",
          message: "Coletar resposta precisa de uma pergunta para enviar ao cliente.",
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: "Coletar resposta precisa de uma var_key para guardar a resposta.",
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: `A var_key "${cfg.var_key}" deve conter apenas letras, números e underscore, e começar com letra ou underscore.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Coletar resposta precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Coletar resposta aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      // Reply-timeout branch (migration 113) — only validated when the
      // toggle is on; off (the default) keeps the original v1.5
      // "wait forever" shape with no second branch to validate.
      if (cfg.timeout_enabled === true) {
        if (
          typeof cfg.timeout_amount !== "number" ||
          !Number.isFinite(cfg.timeout_amount) ||
          cfg.timeout_amount <= 0
        ) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_amount",
            message: "O tempo limite de resposta de Coletar resposta precisa de uma quantidade positiva.",
          });
        }
        if (!cfg.timeout_unit || !["minutes", "hours", "days"].includes(cfg.timeout_unit)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_unit",
            message: "O tempo limite de resposta de Coletar resposta precisa de uma unidade (minutos / horas / dias).",
          });
        }
        if (!cfg.timeout_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_node_key",
            message: "O tempo limite de resposta de Coletar resposta precisa apontar para um nó para quando o cliente não responder a tempo.",
          });
        } else if (!knownKeys.has(cfg.timeout_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_node_key",
            message: `O ramo "Sem resposta" de Coletar resposta aponta para um nó inexistente: "${cfg.timeout_node_key}".`,
          });
        }
        if (
          cfg.timeout_max_resends !== undefined &&
          (typeof cfg.timeout_max_resends !== "number" ||
            !Number.isFinite(cfg.timeout_max_resends) ||
            cfg.timeout_max_resends < 0)
        ) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_max_resends",
            message: "O número de reenvios de Coletar resposta deve ser zero ou um número positivo.",
          });
        }
      }
      break;
    }

    case "wait": {
      const cfg = node.config as {
        amount?: number;
        unit?: "minutes" | "hours" | "days";
        next_node_key?: string;
      };
      if (typeof cfg.amount !== "number" || !Number.isFinite(cfg.amount) || cfg.amount <= 0) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "amount",
          message: "Aguardar precisa de uma quantidade positiva.",
        });
      }
      if (!cfg.unit || !["minutes", "hours", "days"].includes(cfg.unit)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "unit",
          message: "Aguardar precisa de uma unidade (minutos / horas / dias).",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Aguardar precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Aguardar aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "wait_for_reply": {
      const cfg = node.config as {
        timeout_enabled?: boolean;
        amount?: number;
        unit?: "minutes" | "hours" | "days";
        next_node_key?: string;
        timeout_node_key?: string;
      };
      // Migration 113 — omitted `timeout_enabled` defaults to `true`
      // (every pre-113 wait_for_reply node already has these fields
      // populated; they were mandatory). Explicitly `false` relaxes
      // amount/unit/timeout_node_key to "wait forever, single branch".
      const timeoutOn = cfg.timeout_enabled !== false;
      if (timeoutOn) {
        if (typeof cfg.amount !== "number" || !Number.isFinite(cfg.amount) || cfg.amount <= 0) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "amount",
            message: "Aguardar resposta precisa de uma quantidade positiva.",
          });
        }
        if (!cfg.unit || !["minutes", "hours", "days"].includes(cfg.unit)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "unit",
            message: "Aguardar resposta precisa de uma unidade (minutos / horas / dias).",
          });
        }
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Aguardar resposta precisa apontar para um nó para quando o cliente responder.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `O ramo "Respondeu" de Aguardar resposta aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      if (timeoutOn) {
        if (!cfg.timeout_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_node_key",
            message: "Aguardar resposta precisa apontar para um nó para quando o cliente não responder a tempo.",
          });
        } else if (!knownKeys.has(cfg.timeout_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "timeout_node_key",
            message: `O ramo "Sem resposta" de Aguardar resposta aponta para um nó inexistente: "${cfg.timeout_node_key}".`,
          });
        }
      }
      break;
    }

    case "condition": {
      const cfg = node.config as {
        subject?: "var" | "tag" | "contact_field" | "message_content" | "time_of_day";
        subject_key?: string;
        operator?: "equals" | "contains" | "present" | "absent";
        value?: string;
        true_next?: string;
        false_next?: string;
      };
      const knownSubjects = [
        "var",
        "tag",
        "contact_field",
        "message_content",
        "time_of_day",
      ];
      if (!cfg.subject || !knownSubjects.includes(cfg.subject)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject",
          message: "A condição precisa de um assunto (variável / tag / campo do contato / conteúdo da mensagem / horário).",
        });
      }
      // message_content has no subject_key (the subject IS the message
      // text) — it's always a substring match on `value`, mirroring
      // automations' fixed .includes() behaviour regardless of operator.
      if (cfg.subject === "message_content") {
        if (!cfg.value?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "value",
            message: "A condição sobre conteúdo da mensagem precisa de um texto para comparar.",
          });
        }
      } else if (cfg.subject === "time_of_day") {
        // "HH:mm-HH:mm" — mirrors automations' `operand` format.
        if (!cfg.subject_key || !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(cfg.subject_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "subject_key",
            message: 'A condição de horário precisa de uma janela no formato "HH:mm-HH:mm".',
          });
        }
      } else {
        if (!cfg.subject_key?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "subject_key",
            message: "A condição precisa de um subject_key (nome da variável, id da tag ou nome do campo).",
          });
        }
        if (
          !cfg.operator ||
          !["equals", "contains", "present", "absent"].includes(cfg.operator)
        ) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "operator",
            message: "A condição precisa de um operador.",
          });
        } else if (
          (cfg.operator === "equals" || cfg.operator === "contains") &&
          (cfg.value === undefined || cfg.value === "")
        ) {
          issues.push({
            severity: "warning",
            scope: "node",
            node_key: node.node_key,
            field: "value",
            message: `O operador "${cfg.operator}" normalmente espera um valor de comparação — um valor vazio só vai corresponder a assuntos vazios.`,
          });
        }
      }
      for (const branch of ["true_next", "false_next"] as const) {
        const key = cfg[branch];
        if (!key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `A condição precisa de um nó para o ramo "${branch === "true_next" ? "verdadeiro" : "falso"}".`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `O ramo "${branch}" da condição aponta para um nó inexistente: "${key}".`,
          });
        }
      }
      break;
    }

    case "randomizer": {
      const cfg = node.config as {
        split_percent?: number;
        true_next?: string;
        false_next?: string;
      };
      if (
        typeof cfg.split_percent !== "number" ||
        !Number.isFinite(cfg.split_percent) ||
        cfg.split_percent < 0 ||
        cfg.split_percent > 100
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "split_percent",
          message: "O randomizador precisa de um split_percent entre 0 e 100.",
        });
      }
      for (const branch of ["true_next", "false_next"] as const) {
        const key = cfg[branch];
        if (!key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `O randomizador precisa de um nó para o grupo "${branch === "true_next" ? "A" : "B"}".`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `O ramo "${branch}" do randomizador aponta para um nó inexistente: "${key}".`,
          });
        }
      }
      break;
    }

    case "set_tag": {
      const cfg = node.config as {
        mode?: "add" | "remove";
        tag_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !["add", "remove"].includes(cfg.mode)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "mode",
          message: "Definir tag precisa de um modo (adicionar ou remover).",
        });
      }
      if (!cfg.tag_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "tag_id",
          message: "Definir tag precisa de uma tag para aplicar.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Definir tag precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Definir tag aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "start_flow": {
      const cfg = node.config as {
        flow_id?: string;
        next_node_key?: string;
      };
      if (!cfg.flow_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "flow_id",
          message: '"Iniciar outro fluxo" precisa de um fluxo para iniciar.',
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: '"Iniciar outro fluxo" precisa apontar para um próximo nó.',
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `"Iniciar outro fluxo" aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      // Self-reference + target-availability checks live in
      // checkStartFlowNodes (needs the flow's own id + account's flow
      // list, which validateNode's per-node signature doesn't carry).
      break;
    }

    case "create_deal": {
      const cfg = node.config as {
        title?: string;
        value?: number;
        next_node_key?: string;
      };
      if (!cfg.title?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "title",
          message: "Criar negócio precisa de um título.",
        });
      }
      if (
        cfg.value !== undefined &&
        (typeof cfg.value !== "number" || !Number.isFinite(cfg.value) || cfg.value < 0)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "value",
          message: "O valor de Criar negócio deve ser um número não negativo.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Criar negócio precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Criar negócio aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "update_deal_stage": {
      const cfg = node.config as { stage_id?: string; next_node_key?: string };
      if (!cfg.stage_id?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "stage_id",
          message: "Atualizar etapa do negócio precisa de uma etapa de destino.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Atualizar etapa do negócio precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Atualizar etapa do negócio aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "update_deal_value": {
      const cfg = node.config as { value?: number; next_node_key?: string };
      if (typeof cfg.value !== "number" || !Number.isFinite(cfg.value) || cfg.value < 0) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "value",
          message: "Atualizar valor do negócio precisa de um número não negativo.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Atualizar valor do negócio precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Atualizar valor do negócio aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "mark_deal_won": {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Marcar negócio como ganho precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Marcar negócio como ganho aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "mark_deal_lost": {
      const cfg = node.config as { reason?: string; next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Marcar negócio como perdido precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Marcar negócio como perdido aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "assign_conversation": {
      const cfg = node.config as {
        mode?: "specific" | "round_robin";
        agent_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !["specific", "round_robin"].includes(cfg.mode)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "mode",
          message: "Atribuir conversa precisa de um modo (específico ou round_robin).",
        });
      } else if (cfg.mode === "specific" && !cfg.agent_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "agent_id",
          message: "Atribuir conversa no modo específico precisa de um agente.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Atribuir conversa precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Atribuir conversa aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "update_contact_field": {
      const cfg = node.config as {
        field?: string;
        value?: string;
        next_node_key?: string;
      };
      if (!cfg.field?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "field",
          message: "Atualizar campo do contato precisa de um campo para escrever.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Atualizar campo do contato precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Atualizar campo do contato aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "unassign_agent":
    case "open_conversation":
    case "set_conversation_pending":
    case "close_conversation":
    case "mark_as_read": {
      const cfg = node.config as { next_node_key?: string };
      const label = GENERIC_NODE_LABELS[node.node_type] ?? node.node_type;
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `${label} precisa apontar para um próximo nó.`,
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `${label} aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_webhook": {
      const cfg = node.config as { url?: string; next_node_key?: string };
      if (!cfg.url?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "url",
          message: "Enviar webhook precisa de uma URL.",
        });
      } else {
        try {
          new URL(cfg.url);
        } catch {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "url",
            message: `"${cfg.url}" não é uma URL válida.`,
          });
        }
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Enviar webhook precisa apontar para um próximo nó.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Enviar webhook aponta para um nó inexistente: "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "stop_flow":
    case "handoff":
    case "end":
      // Terminal nodes have no outgoing edges; nothing to validate
      // beyond their existence.
      break;

    default:
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Tipo de nó desconhecido: "${node.node_type}".`,
      });
  }

  return issues;
}

// ============================================================
// Reachability — BFS from the entry, follow outgoing edges per node
// ============================================================

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[],
): Set<string> {
  const byKey = new Map<string, NodeInput>();
  for (const n of nodes) byKey.set(n.node_key, n);

  const visited = new Set<string>();
  const queue: string[] = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    for (const next of outgoingEdges(node)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function outgoingEdges(node: NodeInput): string[] {
  switch (node.node_type) {
    case "collect_input": {
      const cfg = node.config as {
        next_node_key?: string;
        timeout_enabled?: boolean;
        timeout_node_key?: string;
      };
      const out: string[] = [];
      if (cfg.next_node_key) out.push(cfg.next_node_key);
      if (cfg.timeout_enabled === true && cfg.timeout_node_key) {
        out.push(cfg.timeout_node_key);
      }
      return out;
    }
    case "start":
    case "send_message":
    case "send_media":
    case "send_template":
    case "set_tag":
    case "start_flow":
    case "create_deal":
    case "update_deal_stage":
    case "update_deal_value":
    case "mark_deal_won":
    case "mark_deal_lost":
    case "assign_conversation":
    case "unassign_agent":
    case "update_contact_field":
    case "open_conversation":
    case "set_conversation_pending":
    case "close_conversation":
    case "mark_as_read":
    case "send_webhook":
    case "wait": {
      const cfg = node.config as { next_node_key?: string };
      return cfg.next_node_key ? [cfg.next_node_key] : [];
    }
    case "condition":
    case "randomizer": {
      const cfg = node.config as {
        true_next?: string;
        false_next?: string;
      };
      const out: string[] = [];
      if (cfg.true_next) out.push(cfg.true_next);
      if (cfg.false_next) out.push(cfg.false_next);
      return out;
    }
    case "wait_for_reply": {
      const cfg = node.config as {
        timeout_enabled?: boolean;
        next_node_key?: string;
        timeout_node_key?: string;
      };
      const out: string[] = [];
      if (cfg.next_node_key) out.push(cfg.next_node_key);
      if (cfg.timeout_enabled !== false && cfg.timeout_node_key) {
        out.push(cfg.timeout_node_key);
      }
      return out;
    }
    case "send_buttons": {
      const cfg = node.config as {
        buttons?: Array<{ next_node_key?: string }>;
      };
      return (cfg.buttons ?? [])
        .map((b) => b.next_node_key)
        .filter((k): k is string => !!k);
    }
    case "send_list": {
      const cfg = node.config as {
        sections?: Array<{ rows?: Array<{ next_node_key?: string }> }>;
      };
      const out: string[] = [];
      for (const s of cfg.sections ?? []) {
        for (const r of s.rows ?? []) {
          if (r.next_node_key) out.push(r.next_node_key);
        }
      }
      return out;
    }
    case "handoff":
    case "end":
    case "stop_flow":
    default:
      return [];
  }
}
