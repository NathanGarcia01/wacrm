import { getAnthropicClient, extractJson } from "./client";

/**
 * Natural-language → automation draft. Mirrors the real schema in
 * src/types/index.ts (AutomationTriggerType/AutomationStepType) and the
 * nested-tree shape `insertSteps` (src/lib/automations/steps-tree.ts)
 * expects, so a generated draft can be POSTed to /api/automations as-is.
 */

const TRIGGER_TYPES = [
  "new_message_received",
  "first_inbound_message",
  "first_outbound_message",
  "keyword_match",
  "new_contact_created",
  "conversation_assigned",
  "tag_added",
  "time_based",
] as const;

const STEP_TYPES = [
  "send_message",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
] as const;

export interface AutomationDraftStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes: AutomationDraftStep[]; no: AutomationDraftStep[] };
}

export interface AutomationDraft {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  steps: AutomationDraftStep[];
}

export type GenerateAutomationResult =
  | { ok: true; draft: AutomationDraft }
  | { ok: false; error: string };

const SYSTEM_PROMPT = `Você é um assistente que converte descrições em linguagem natural em uma estrutura de automação de CRM para WhatsApp (produto Funilly).

Gatilhos disponíveis (trigger_type):
- new_message_received: qualquer mensagem recebida — trigger_config: {}
- first_inbound_message: primeira mensagem recebida do contato — trigger_config: {}
- first_outbound_message: primeira mensagem enviada pelo atendente — trigger_config: {}
- keyword_match: mensagem contém palavra-chave — trigger_config: { "keywords": string[], "match_type": "exact"|"contains", "case_sensitive"?: boolean }
- new_contact_created: um novo contato é criado — trigger_config: {}
- conversation_assigned: conversa é atribuída a um atendente — trigger_config: {}
- tag_added: uma tag é adicionada ao contato — trigger_config: { "tag_id": string }
- time_based: horário programado — trigger_config: { "schedule": string (formato "HH:mm" ou cron), "timezone"?: string }

Passos disponíveis (step_type), executados em sequência (exceto "condition", que ramifica):
- send_message — step_config: { "text": string } — o texto pode usar {{contact.name}}, {{contact.phone}}, {{message.text}}, {{vars.*}}
- send_template — step_config: { "template_name": string, "language"?: string, "variables"?: object }
- add_tag / remove_tag — step_config: { "tag_id": string }
- assign_conversation — step_config: { "mode": "specific"|"round_robin", "agent_id"?: string }
- update_contact_field — step_config: { "field": string ("name"|"email"|"company" ou "custom:<id>"), "value": string }
- create_deal — step_config: { "title": string, "pipeline_id"?: string, "stage_id"?: string, "value"?: number } (deixe pipeline_id/stage_id de fora para usar o pipeline padrão)
- wait — step_config: { "amount": number, "unit": "minutes"|"hours"|"days" }
- condition — step_config: { "subject": "contact_field"|"tag_presence"|"message_content"|"time_of_day", "operand"?: string, "value"?: string }. Este é o ÚNICO step que ramifica: inclua um campo extra "branches": { "yes": Step[], "no": Step[] } com os passos de cada ramo (arrays podem ser vazios)
- send_webhook — step_config: { "url": string, "headers"?: object, "body_template"?: string }
- close_conversation — step_config: {}

Regras:
- Cada step é um objeto: { "step_type": string, "step_config": object, "branches"?: {...} }. "branches" só é permitido quando step_type é "condition".
- Escolha o gatilho e os passos que melhor representem a descrição, na ordem em que fariam sentido.
- Se a descrição mencionar um tempo de espera (ex: "depois de 24 horas"), use um step "wait" antes do próximo passo.
- Se a descrição mencionar uma condição ("se... senão..."), use um step "condition" com os passos de cada caso em "branches.yes" e "branches.no".
- Quando o nome de uma tag, template ou pipeline específico não for dado, use uma string vazia "" no campo correspondente — o usuário completa isso depois no editor.

Responda APENAS com um JSON válido, sem markdown e sem comentários, exatamente neste formato:
{
  "name": "nome curto para a automação",
  "description": "descrição curta ou null",
  "trigger_type": "um dos trigger_type acima",
  "trigger_config": { ... },
  "steps": [ { "step_type": "...", "step_config": { ... } }, ... ]
}`;

export async function generateAutomationDraft(
  description: string,
): Promise<GenerateAutomationResult> {
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
    console.error("[ai] generateAutomationDraft request failed:", err);
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

function sanitizeDraft(input: unknown): AutomationDraft | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  const trigger_type =
    typeof obj.trigger_type === "string" &&
    (TRIGGER_TYPES as readonly string[]).includes(obj.trigger_type)
      ? obj.trigger_type
      : null;
  if (!trigger_type) return null;

  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : "Automação gerada por IA";
  const description = typeof obj.description === "string" ? obj.description : null;
  const trigger_config =
    obj.trigger_config && typeof obj.trigger_config === "object"
      ? (obj.trigger_config as Record<string, unknown>)
      : {};
  const steps = sanitizeSteps(Array.isArray(obj.steps) ? obj.steps : []);

  return { name, description, trigger_type, trigger_config, steps };
}

function sanitizeSteps(input: unknown[]): AutomationDraftStep[] {
  const out: AutomationDraftStep[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const step_type =
      typeof s.step_type === "string" && (STEP_TYPES as readonly string[]).includes(s.step_type)
        ? s.step_type
        : null;
    if (!step_type) continue;
    const step_config =
      s.step_config && typeof s.step_config === "object"
        ? (s.step_config as Record<string, unknown>)
        : {};
    const step: AutomationDraftStep = { step_type, step_config };
    if (step_type === "condition") {
      const b = s.branches && typeof s.branches === "object" ? (s.branches as Record<string, unknown>) : {};
      step.branches = {
        yes: Array.isArray(b.yes) ? sanitizeSteps(b.yes) : [],
        no: Array.isArray(b.no) ? sanitizeSteps(b.no) : [],
      };
    }
    out.push(step);
  }
  return out;
}
