import type { SupabaseClient } from '@supabase/supabase-js'
import { isPhoneBlocked } from './blocked-phones'

/**
 * Fase 5, Etapa 6 — a send_template step/node (automations or flows)
 * must respect the marketing opt-out (blocked_phones, migration 091)
 * when the template being sent is categorized 'Marketing'. Utility
 * and Authentication templates are never blocked — they're not
 * marketing, the same distinction Meta itself draws (error 131050
 * only ever applies to marketing-category sends).
 *
 * Fase 2 (Radar) — produto: unconditional now, for every account.
 * This used to also require accounts.broadcast_optout_enforced to be
 * on; that flag now controls only the auto-reply confirmation text
 * sent when a block is captured (see opt-out-handler.ts), never
 * whether a block is actually respected when sending.
 */
export async function isMarketingTemplateSendBlocked(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    templateName: string
    templateLanguage?: string
  },
): Promise<boolean> {
  const { data: template } = await db
    .from('message_templates')
    .select('category')
    .eq('account_id', args.accountId)
    .eq('name', args.templateName)
    .eq('language', args.templateLanguage || 'en_US')
    .maybeSingle()
  if (!template || template.category !== 'Marketing') return false

  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', args.contactId)
    .maybeSingle()
  if (!contact?.phone) return false

  return isPhoneBlocked(db, args.accountId, contact.phone)
}
