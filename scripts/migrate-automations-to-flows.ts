/**
 * Fase I da unificação automations → flows (plano em
 * ~/.claude/plans/piped-strolling-cray.md). Converte cada `automations`
 * row (+ sua árvore em `automation_steps`) numa `flows` row equivalente
 * com `run_mode='workflow'` (+ `flow_nodes` no formato de grafo).
 *
 * Usage:
 *   npx tsx scripts/migrate-automations-to-flows.ts --dry-run [--account-id=<uuid>]
 *   npx tsx scripts/migrate-automations-to-flows.ts [--account-id=<uuid>]   # escreve de verdade
 *
 * Idempotente: automations com `migrated_to_flow_id` já preenchido são
 * puladas (reportadas como "already migrated"), então rodar de novo é
 * seguro.
 *
 * Todo flow criado nasce em status='draft', NUNCA 'active' — mesmo que
 * a automation de origem seja is_active=true. Isso é deliberado: até a
 * Fase J apontar o cron/dispatchers pra parar de disparar automations
 * já migradas, a automation original AINDA está rodando; se o flow
 * migrado nascesse ativo, o mesmo evento disparia os dois motores ao
 * mesmo tempo (disparo duplicado). Um humano revisa e ativa cada flow
 * manualmente quando estiver pronto para a Fase J.
 *
 * ------------------------------------------------------------
 * Conversão árvore → grafo
 * ------------------------------------------------------------
 * automation_steps é uma ÁRVORE: steps rodam em ordem de `position`
 * dentro de um escopo (raiz, ou um branch yes/no de um
 * condition/randomizer); ao terminar um branch (sem cair num `wait`
 * ou `stop_automation`), a execução AUTOMATICAMENTE volta e continua
 * no escopo pai, na próxima posição depois do condition/randomizer
 * (ver `executeStepsFrom` em src/lib/automations/engine.ts).
 *
 * flow_nodes é um GRAFO FLAT: cada node aponta pro próximo via
 * `next_node_key` dentro do próprio config. Não existe "escopo pai" —
 * o "voltar pro pai" da árvore precisa ser "costurado" explicitamente:
 * ao converter os filhos de um branch, o parâmetro `continuation`
 * carrega qual node_key usar quando aquele branch se esgotar
 * naturalmente (o sucessor do condition/randomizer no escopo DELE, que
 * por sua vez pode ser o continuation herdado de um nível ainda mais
 * acima — a recursão propaga isso até a raiz).
 *
 * ------------------------------------------------------------
 * Limitação arquitetural conhecida: `wait` dentro de um branch
 * ------------------------------------------------------------
 * Em automations, um `wait` DENTRO de um branch só suspende AQUELE
 * branch — o escopo pai (e qualquer ancestral) continua executando
 * IMEDIATAMENTE assim que a chamada recursiva de `executeStepsFrom`
 * retorna, sem esperar o wait resolver. Em flows, `wait` suspende a
 * run INTEIRA (só existe um `current_node_key` por run) — não há como
 * modelar fielmente "este branch específico pausou, mas o resto
 * continua" num grafo de ponteiro único.
 *
 * Detecção: para cada condition/randomizer cujo subtree (qualquer
 * branch, qualquer profundidade) contém um `wait`, se esse
 * condition/randomizer tem algo de verdade DEPOIS dele no escopo onde
 * vive (`continuation` != node de fim sintético da automation inteira),
 * a automation inteira é marcada como não migrável automaticamente e
 * NENHUM flow é criado pra ela — só reportada, pra decisão manual.
 *
 * ------------------------------------------------------------
 * Referências cruzadas: start_automation → start_flow
 * ------------------------------------------------------------
 * automations podem disparar OUTRAS automations por id
 * (`start_automation.automation_id`) — inclusive fora de ordem ou em
 * ciclo. Resolvido em 2 passadas: passada 1 cria todos os flows com um
 * placeholder (`PENDING:<automation_id>`) em `start_flow.flow_id`;
 * passada 2 (depois que TODAS as automations elegíveis já viraram
 * flow) troca cada placeholder pelo `flows.id` real via o mapa
 * automation_id→flow_id construído na passada 1. Uma referência a uma
 * automation que não foi migrada (pulada, ou id inexistente) vira
 * `flow_id: ''` — o próprio executor de `start_flow` já trata isso
 * como "flow não encontrado, pula e segue" (workflow-engine.ts), e o
 * caso é reportado como aviso.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { PENDING_PREFIX, convertTree, type StepNode } from "./lib/automation-flow-conversion";

const DRY_RUN = process.argv.includes("--dry-run");
const ACCOUNT_ID_ARG =
  process.argv.find((a) => a.startsWith("--account-id="))?.split("=")[1] ?? null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.local.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ------------------------------------------------------------
// Row shapes
// ------------------------------------------------------------

interface AutomationRow {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  migrated_to_flow_id: string | null;
}

interface StepRow {
  id: string;
  parent_step_id: string | null;
  branch: "yes" | "no" | null;
  step_type: string;
  step_config: Record<string, unknown>;
  position: number;
}

// ------------------------------------------------------------
// Tree loading — same shape as src/lib/automations/steps-tree.ts's
// loadStepsTree, reimplemented here so this script has no dependency
// on Next.js path aliases (it runs standalone via tsx).
// ------------------------------------------------------------

async function loadStepsTree(automationId: string): Promise<StepNode[]> {
  const { data, error } = await db
    .from("automation_steps")
    .select("*")
    .eq("automation_id", automationId)
    .order("position", { ascending: true });
  if (error) throw new Error(`automation_steps lookup failed: ${error.message}`);

  const rows = (data ?? []) as StepRow[];
  const byId = new Map<string, StepNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      step_type: row.step_type,
      step_config: row.step_config ?? {},
      branches: { yes: [], no: [] },
    });
  }
  const roots: StepNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_step_id) {
      const parent = byId.get(row.parent_step_id);
      if (parent) parent.branches[row.branch ?? "yes"].push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

interface Summary {
  totalAutomations: number;
  alreadyMigrated: number;
  migratedNow: number;
  skippedWaitInBranch: number;
  errors: number;
  startFlowWarnings: string[];
}

async function main() {
  const summary: Summary = {
    totalAutomations: 0,
    alreadyMigrated: 0,
    migratedNow: 0,
    skippedWaitInBranch: 0,
    errors: 0,
    startFlowWarnings: [],
  };

  console.log(
    `Migração automations → flows — ${DRY_RUN ? "DRY RUN (nenhuma escrita)" : "LIVE — escrevendo no banco"}` +
      (ACCOUNT_ID_ARG ? ` — conta ${ACCOUNT_ID_ARG}` : " — todas as contas"),
  );
  console.log("");

  let query = db
    .from("automations")
    .select("id, account_id, user_id, name, description, trigger_type, trigger_config, migrated_to_flow_id")
    .order("created_at", { ascending: true });
  if (ACCOUNT_ID_ARG) query = query.eq("account_id", ACCOUNT_ID_ARG);
  const { data: automations, error } = await query;
  if (error) {
    console.error("Failed to load automations:", error.message);
    process.exit(1);
  }

  const rows = (automations ?? []) as AutomationRow[];
  summary.totalAutomations = rows.length;

  // automation_id -> newly created (or dry-run hypothetical) flow_id.
  const flowIdByAutomationId = new Map<string, string>();
  // Pending nodes needing a pass-2 start_flow.flow_id fixup:
  // (flow_id, node_key, target automation_id).
  const pendingStartFlowFixups: { flowId: string; nodeKey: string; automationId: string }[] = [];

  for (const automation of rows) {
    const label = `${automation.name} (${automation.id})`;

    if (automation.migrated_to_flow_id) {
      summary.alreadyMigrated++;
      console.log(`  = ${label}: already migrated → flow ${automation.migrated_to_flow_id}, skipping`);
      flowIdByAutomationId.set(automation.id, automation.migrated_to_flow_id);
      continue;
    }

    try {
      const tree = await loadStepsTree(automation.id);
      const result = convertTree(tree);

      if (!result.ok) {
        summary.skippedWaitInBranch++;
        console.log(`  ! ${label}: SKIPPED — ${result.reason}`);
        continue;
      }

      console.log(
        `  + ${label}: would create flow with ${result.nodes.length} node(s), entry="${result.entryNodeKey}"`,
      );

      if (DRY_RUN) {
        summary.migratedNow++;
        // Dry-run placeholder id so start_flow cross-references between
        // two automations migrated in the same dry-run still resolve
        // for reporting purposes.
        flowIdByAutomationId.set(automation.id, `dry-run-flow-${automation.id}`);
        continue;
      }

      const { data: flow, error: flowErr } = await db
        .from("flows")
        .insert({
          account_id: automation.account_id,
          user_id: automation.user_id,
          name: automation.name,
          description: automation.description,
          status: "draft",
          run_mode: "workflow",
          trigger_type: automation.trigger_type,
          trigger_config: automation.trigger_config ?? {},
          entry_node_id: result.entryNodeKey,
        })
        .select("id")
        .single();
      if (flowErr || !flow) {
        throw new Error(`flows insert failed: ${flowErr?.message}`);
      }
      const flowId = flow.id as string;

      const nodeRows = result.nodes.map((n) => ({
        flow_id: flowId,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
      }));
      const { error: nodesErr } = await db.from("flow_nodes").insert(nodeRows);
      if (nodesErr) throw new Error(`flow_nodes insert failed: ${nodesErr.message}`);

      const { error: markErr } = await db
        .from("automations")
        .update({ migrated_to_flow_id: flowId })
        .eq("id", automation.id);
      if (markErr) throw new Error(`automations.migrated_to_flow_id update failed: ${markErr.message}`);

      flowIdByAutomationId.set(automation.id, flowId);
      for (const n of result.nodes) {
        if (n.node_type === "start_flow" && (n.config.flow_id as string)?.startsWith(PENDING_PREFIX)) {
          const targetAutomationId = (n.config.flow_id as string).slice(PENDING_PREFIX.length);
          pendingStartFlowFixups.push({ flowId, nodeKey: n.node_key, automationId: targetAutomationId });
        }
      }
      summary.migratedNow++;
    } catch (err) {
      summary.errors++;
      console.error(`  ! ${label}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Pass 2: resolve start_flow cross-references ----
  console.log("");
  console.log(`Pass 2 — resolving ${pendingStartFlowFixups.length} start_flow cross-reference(s)...`);
  for (const fixup of pendingStartFlowFixups) {
    const targetFlowId = flowIdByAutomationId.get(fixup.automationId);
    if (!targetFlowId) {
      const warning =
        `flow ${fixup.flowId} node ${fixup.nodeKey}: start_automation targeted automation ` +
        `${fixup.automationId}, which was never migrated (missing, skipped, or not yet run) — ` +
        `left as a no-op (empty flow_id).`;
      summary.startFlowWarnings.push(warning);
      console.log(`  ! ${warning}`);
      if (DRY_RUN) continue;
      const { error } = await db
        .from("flow_nodes")
        .update({ config: { flow_id: "" } })
        .eq("flow_id", fixup.flowId)
        .eq("node_key", fixup.nodeKey);
      if (error) console.error(`    failed to clear placeholder: ${error.message}`);
      continue;
    }
    console.log(`  = flow ${fixup.flowId} node ${fixup.nodeKey} → flow ${targetFlowId}`);
    if (DRY_RUN) continue;
    // Merge into the existing config rather than overwrite (keeps
    // next_node_key intact).
    const { data: existing } = await db
      .from("flow_nodes")
      .select("config")
      .eq("flow_id", fixup.flowId)
      .eq("node_key", fixup.nodeKey)
      .maybeSingle();
    const mergedConfig = { ...(existing?.config as Record<string, unknown> | undefined), flow_id: targetFlowId };
    const { error } = await db
      .from("flow_nodes")
      .update({ config: mergedConfig })
      .eq("flow_id", fixup.flowId)
      .eq("node_key", fixup.nodeKey);
    if (error) console.error(`    failed to fix up flow_id: ${error.message}`);
  }

  console.log("");
  console.log("Summary");
  console.log("-------");
  console.log(`Total automations:            ${summary.totalAutomations}`);
  console.log(`Already migrated (skipped):   ${summary.alreadyMigrated}`);
  console.log(`Migrated ${DRY_RUN ? "(would be)" : "now"}:            ${summary.migratedNow}`);
  console.log(`Skipped (wait-in-branch):     ${summary.skippedWaitInBranch}`);
  console.log(`start_flow cross-ref warnings: ${summary.startFlowWarnings.length}`);
  console.log(`Errors:                       ${summary.errors}`);

  if (DRY_RUN) {
    console.log("");
    console.log("Dry run — nada foi escrito. Rode sem --dry-run para aplicar de verdade.");
  } else {
    console.log("");
    console.log(
      "Todo flow criado está em status='draft' — revise e ative manualmente cada um antes de " +
        "considerar a automation original substituída. A automation original continua ativa e " +
        "disparando até a Fase J.",
    );
  }

  if (summary.errors > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("Migration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
