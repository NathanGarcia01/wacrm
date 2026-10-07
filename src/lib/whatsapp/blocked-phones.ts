import type { SupabaseClient } from '@supabase/supabase-js'

export type BlockedPhoneSource = 'manual' | 'keyword' | 'meta_stop_promotions' | 'cloud_api_error' | 'import'

/**
 * Fase 5 (Transmissões), Etapa 1 — shared read/write helpers for
 * `blocked_phones` (migration 091). Takes the Supabase client as an
 * argument rather than importing an admin singleton, so the same
 * helpers serve the webhook (service role), the future manual-block
 * UI (RLS-scoped, admin-only per the table's policies), and the
 * eventual per-send check in the broadcast cron.
 */

/**
 * Blocks a phone for marketing. No-ops (does not throw) when the
 * phone is already actively blocked — the unique index on
 * (account_id, phone_normalized) WHERE unblocked_at IS NULL (migration
 * 091) would otherwise raise 23505 on a second trigger for the same
 * phone (e.g. two failed sends in a row both carrying error 131050).
 */
export async function blockPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  source: BlockedPhoneSource,
  reason: string | null,
  blockedBy: string | null = null,
): Promise<void> {
  const { error } = await db
    .from('blocked_phones')
    .insert({ account_id: accountId, phone, source, reason, blocked_by: blockedBy })
  if (error && error.code !== '23505') {
    throw error
  }
}

/**
 * Unblocks a phone's currently-active block, but ONLY if its source
 * is in `eligibleSources` — e.g. Meta's own "resume" toggle
 * (user_preferences) must only undo a block that came from that same
 * toggle, never a deliberate manual block by an admin; VOLTAR by
 * keyword is allowed to undo any of the 3 automatic sources (it's an
 * unambiguous signal from the customer themselves) but not 'manual'
 * or 'import' (an admin's reasoned decision isn't undone by a text
 * message alone).
 */
export async function unblockPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  eligibleSources: BlockedPhoneSource[],
  reason: string,
  unblockedBy: string | null = null,
): Promise<void> {
  const phoneNormalized = phone.replace(/\D/g, '')
  const { error } = await db
    .from('blocked_phones')
    .update({ unblocked_at: new Date().toISOString(), unblock_reason: reason, unblocked_by: unblockedBy })
    .eq('account_id', accountId)
    .eq('phone_normalized', phoneNormalized)
    .in('source', eligibleSources)
    .is('unblocked_at', null)
  if (error) throw error
}

export async function isPhoneBlocked(db: SupabaseClient, accountId: string, phone: string): Promise<boolean> {
  const phoneNormalized = phone.replace(/\D/g, '')
  const { data, error } = await db
    .from('blocked_phones')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone_normalized', phoneNormalized)
    .is('unblocked_at', null)
    .maybeSingle()
  if (error) throw error
  return !!data
}
