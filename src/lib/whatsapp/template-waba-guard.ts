import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A template synced from Meta belongs to exactly one WABA (the Business
 * Account it was created/approved under — message_templates.waba_id,
 * migration 105). Two numbers only share a template catalog when they
 * sit on the SAME WABA; sending a template through a number on a
 * different WABA than the one it was approved under fails on Meta's
 * side (or worse, silently hits the wrong catalog if names collide
 * across WABAs). This guard is the single choke point every send path
 * (manual inbox, broadcasts, automations, flows) calls before dispatch.
 *
 * `null` on either side means "unknown" (a template never synced since
 * migration 105 landed, or a channel resolved from the legacy
 * whatsapp_config row / env vars with no waba_id on file) — we don't
 * block on unknown, since that would hide real sends behind a false
 * positive. Only an actual, confirmed mismatch blocks.
 */
export function templateBelongsToWaba(
  templateWabaId: string | null | undefined,
  channelWabaId: string | null | undefined,
): boolean {
  if (!templateWabaId || !channelWabaId) return true
  return templateWabaId === channelWabaId
}

export function templateWabaMismatchMessage(templateName: string): string {
  return `O modelo "${templateName}" pertence a outro número do WhatsApp (WABA diferente) e não pode ser enviado por este número. Sincronize os modelos em Configurações ou escolha outro número.`
}

/**
 * DB-querying variant for call sites that haven't already loaded the
 * template row (automations/flows engines) — looks it up by the same
 * (account_id, name, language) triple the unique index enforces, then
 * delegates to templateBelongsToWaba. Throws when mismatched; no-ops
 * when the template isn't found locally (nothing to compare against —
 * the Meta call itself will surface a real error if the name is bad).
 */
export async function assertTemplateMatchesChannelWaba(
  db: SupabaseClient,
  args: {
    accountId: string
    templateName: string
    templateLanguage?: string
    channelWabaId: string | null
  },
): Promise<void> {
  const { data: template } = await db
    .from('message_templates')
    .select('waba_id')
    .eq('account_id', args.accountId)
    .eq('name', args.templateName)
    .eq('language', args.templateLanguage || 'en_US')
    .maybeSingle()

  if (!template) return
  if (!templateBelongsToWaba(template.waba_id, args.channelWabaId)) {
    throw new Error(templateWabaMismatchMessage(args.templateName))
  }
}
