import { getAnthropicClient, extractJson } from "./client";

/**
 * Natural-language → flow draft. Mirrors the real node schema in
 * src/lib/flows/types.ts. Deliberately restricted to node types that need
 * no external asset (excludes send_buttons/send_list/send_media, which
 * need real button reply_ids / uploaded media the model can't produce,
 * and "start", which is redundant — entry_node_id points straight at the
 * first real node).
 */

const ALLOWED_NODE_TYPES = [
  "send_message",
  "collect_input",
  "condition",
  "set_tag",
  "handoff",
  "end",
] as const;

const ALLOWED_TRIGGER_TYPES = ["keyword", "first_inbound_message", "manual"] as const;

export interface FlowDraftNode {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export interface FlowDraft {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowDraftNode[];
}

export type GenerateFlowResult =
  | { ok: true; draft: FlowDraft }
  | { ok: false; error: string };

const SYSTEM_PROMPT = `Você é um assistente que converte descrições em linguagem natural em uma estrutura de fluxo conversacional de WhatsApp (produto Funilly).

Um fluxo é um grafo de nós conectados por "node_key" (identificador de texto estável em snake_case, ex: "boas_vindas", "perguntar_motivo"). Tipos de nó permitidos (node_type):

- send_message — config: { "text": string, "next_node_key": string } — o texto pode usar {{vars.*}}
- collect_input — config: { "prompt_text": string, "var_key": string, "next_node_key": string } — envia uma pergunta e aguarda a resposta em texto livre do cliente, guardando o valor em vars[var_key]
- condition — config: { "subject": "var"|"tag"|"contact_field", "subject_key": string, "operator": "equals"|"contains"|"present"|"absent", "value"?: string, "true_next": string, "false_next": string } — ramifica em dois caminhos
- set_tag — config: { "mode": "add"|"remove", "tag_id": string, "next_node_key": string }
- handoff — config: { "note"?: string } — transfere a conversa para um atendente humano e ENCERRA o fluxo (sem next_node_key)
- end — config: {} — encerra o fluxo (sem next_node_key)

NÃO use os tipos "send_buttons", "send_list", "send_media" ou "start" — eles exigem configuração manual (botões, arquivos de mídia) que não pode ser gerada a partir de uma descrição em texto. Se a descrição mencionar um menu de opções, use "collect_input" perguntando a escolha em texto livre e um "condition" para rotear pela resposta.

Gatilhos disponíveis (trigger_type):
- keyword — trigger_config: { "keywords": string[] }
- first_inbound_message — trigger_config: {}
- manual — trigger_config: {} — usado quando o fluxo deve ser acionado manualmente pelo atendente, não automaticamente

Regras:
- Todo fluxo deve terminar em pelo menos um nó "end" ou "handoff".
- Cada "node_key" deve ser único.
- Todo "next_node_key" / "true_next" / "false_next" deve apontar para um "node_key" que exista no array "nodes".
- "entry_node_id" é o node_key do primeiro nó a ser executado.

Responda APENAS com um JSON válido, sem markdown e sem comentários, exatamente neste formato:
{
  "name": "nome curto para o fluxo",
  "description": "descrição curta ou null",
  "trigger_type": "keyword" | "first_inbound_message" | "manual",
  "trigger_config": { ... },
  "entry_node_id": "node_key do primeiro nó",
  "nodes": [ { "node_key": "...", "node_type": "...", "config": { ... } }, ... ]
}`;

export async function generateFlowDraft(description: string): Promise<GenerateFlowResult> {
  const client = getAnthropicClient();
  let raw: string;
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: description }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "empty_response" };
    }
    raw = textBlock.text;
  } catch (err) {
    console.error("[ai] generateFlowDraft request failed:", err);
    return { ok: false, error: "request_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  const draft = sanitizeDraft(parsed);
  if (!draft) return { ok: false, error: "invalid_structure" };
  return { ok: true, draft };
}

function sanitizeDraft(input: unknown): FlowDraft | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  const trigger_type =
    typeof obj.trigger_type === "string" &&
    (ALLOWED_TRIGGER_TYPES as readonly string[]).includes(obj.trigger_type)
      ? obj.trigger_type
      : "manual";
  const name =
    typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Fluxo gerado por IA";
  const description = typeof obj.description === "string" ? obj.description : null;
  const trigger_config =
    obj.trigger_config && typeof obj.trigger_config === "object"
      ? (obj.trigger_config as Record<string, unknown>)
      : {};

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const nodes: FlowDraftNode[] = [];
  const seenKeys = new Set<string>();
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") continue;
    const n = raw as Record<string, unknown>;
    const node_type =
      typeof n.node_type === "string" &&
      (ALLOWED_NODE_TYPES as readonly string[]).includes(n.node_type)
        ? n.node_type
        : null;
    const node_key = typeof n.node_key === "string" && n.node_key.trim() ? n.node_key.trim() : null;
    if (!node_type || !node_key || seenKeys.has(node_key)) continue;
    seenKeys.add(node_key);
    const config =
      n.config && typeof n.config === "object" ? { ...(n.config as Record<string, unknown>) } : {};
    nodes.push({ node_key, node_type, config });
  }
  if (nodes.length === 0) return null;

  // Guarantee a terminal node — the model occasionally forgets one when
  // the description doesn't describe an explicit ending.
  const hasTerminal = nodes.some((n) => n.node_type === "end" || n.node_type === "handoff");
  if (!hasTerminal) {
    nodes.push({ node_key: "fim_auto", node_type: "end", config: {} });
  }
  const endKey =
    nodes.find((n) => n.node_type === "end")?.node_key ??
    nodes.find((n) => n.node_type === "handoff")!.node_key;
  const keySet = new Set(nodes.map((n) => n.node_key));
  const clamp = (key: unknown): string =>
    typeof key === "string" && keySet.has(key) ? key : endKey;

  // Clamp every outgoing edge to an existing node_key — a dangling
  // reference would otherwise crash the runner (advanceFromNodeKey logs
  // node_not_found and fails the run) instead of just looking odd in the
  // builder, where it's easy to fix by hand.
  for (const node of nodes) {
    switch (node.node_type) {
      case "send_message":
      case "set_tag":
        node.config.next_node_key = clamp(node.config.next_node_key);
        break;
      case "collect_input":
        node.config.next_node_key = clamp(node.config.next_node_key);
        if (typeof node.config.var_key !== "string" || !node.config.var_key.trim()) {
          node.config.var_key = "resposta";
        }
        break;
      case "condition":
        node.config.true_next = clamp(node.config.true_next);
        node.config.false_next = clamp(node.config.false_next);
        if (typeof node.config.subject !== "string") node.config.subject = "var";
        if (typeof node.config.operator !== "string") node.config.operator = "present";
        break;
      // handoff / end have no outgoing edge.
    }
  }

  const entry_node_id =
    typeof obj.entry_node_id === "string" && keySet.has(obj.entry_node_id)
      ? obj.entry_node_id
      : nodes[0].node_key;

  return { name, description, trigger_type, trigger_config, entry_node_id, nodes };
}
