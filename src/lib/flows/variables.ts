import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dynamic variables available in flow/automation `send_message` and
 * `send_template` text — `{{nome}}`, `{{primeiro_nome}}`, `{{telefone}}`,
 * `{{email}}`, `{{atendente}}`, `{{empresa}}`, `{{data}}`, `{{hora}}`.
 *
 * Deliberately a separate, un-namespaced vocabulary from the engines'
 * own `{{contact.name}}` / `{{vars.foo}}` / `{{message.text}}` tokens
 * (flows/engine.ts's `interpolateVars`, flows/workflow-engine.ts's and
 * automations/engine.ts's `interpolate`) and from Meta template's
 * numeric `{{1}}`, `{{2}}`, … placeholders — `resolveVariables` only
 * ever touches its own known keys and leaves every other `{{...}}`
 * token untouched, so it composes safely with whichever of those a
 * caller also applies.
 */

export interface VariableContact {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface VariableAssignedAgent {
  full_name?: string | null;
}

export interface VariableAccount {
  name?: string | null;
}

export interface VariableContext {
  contact?: VariableContact | null;
  assignedAgent?: VariableAssignedAgent | null;
  account?: VariableAccount | null;
  /** Defaults to `new Date()` — pass explicitly in tests for deterministic {{data}}/{{hora}}. */
  now?: Date;
}

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

/**
 * Replaces the named tokens above with values from `context`. Any
 * `{{...}}` token this function doesn't recognize (numeric Meta
 * placeholders, `{{contact.name}}`, `{{vars.x}}`, …) is left exactly
 * as-is, so it's always safe to run before or after the engines' own
 * interpolation step.
 */
export function resolveVariables(text: string, context: VariableContext): string {
  if (!text) return text;
  const now = context.now ?? new Date();
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    switch (key) {
      case "nome":
        return context.contact?.name?.trim() || "";
      case "primeiro_nome":
        return firstName(context.contact?.name);
      case "telefone":
        return context.contact?.phone?.trim() || "";
      case "email":
        return context.contact?.email?.trim() || "";
      case "atendente":
        return context.assignedAgent?.full_name?.trim() || "";
      case "empresa":
        return context.account?.name?.trim() || "";
      case "data":
        return formatDate(now);
      case "hora":
        return formatTime(now);
      default:
        return match;
    }
  });
}

/**
 * Fetches the contact / assigned agent / account rows a send step
 * needs to resolve `resolveVariables`'s tokens. Takes a service-role
 * client — both flow engines' and the automations engine's
 * `supabaseAdmin()` return one, since sends happen outside any user
 * session.
 */
export async function loadVariableContext(
  db: SupabaseClient,
  params: { accountId: string; contactId?: string | null; conversationId?: string | null },
): Promise<VariableContext> {
  const [contactRes, accountRes, conversationRes] = await Promise.all([
    params.contactId
      ? db.from("contacts").select("name, phone, email").eq("id", params.contactId).maybeSingle()
      : Promise.resolve({ data: null as { name: string | null; phone: string | null; email: string | null } | null }),
    db.from("accounts").select("name").eq("id", params.accountId).maybeSingle(),
    params.conversationId
      ? db
          .from("conversations")
          .select("assigned_agent_id")
          .eq("id", params.conversationId)
          .maybeSingle()
      : Promise.resolve({ data: null as { assigned_agent_id: string | null } | null }),
  ]);

  // assigned_agent_id stores the agent's auth user id (profiles.user_id),
  // not profiles.id — same convention as the assign_conversation node
  // and the inbox's bulk-assign action.
  let assignedAgent: VariableAssignedAgent | null = null;
  const assignedAgentId = conversationRes.data?.assigned_agent_id ?? null;
  if (assignedAgentId) {
    const { data } = await db
      .from("profiles")
      .select("full_name")
      .eq("user_id", assignedAgentId)
      .maybeSingle();
    assignedAgent = data ?? null;
  }

  return {
    contact: contactRes.data,
    account: accountRes.data,
    assignedAgent,
  };
}
