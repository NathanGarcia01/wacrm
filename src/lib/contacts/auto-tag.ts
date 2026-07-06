import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Links a contact to one of the given tag names — used by the
 * "Receptivo" (inbound reply) and "Disparo" (broadcast recipient)
 * auto-tagging rules.
 *
 * Matches case-insensitively against `candidateNames` in priority
 * order (accounts have inconsistent existing casing, e.g. both
 * "Receptivo" and "RECEPTIVO"); the oldest matching tag wins when more
 * than one candidate matches, so results are stable across calls.
 *
 * Never creates a tag — these are background jobs (webhook, broadcast
 * cron) with no signed-in user to gate a create-if-missing against, so
 * if none of the candidate names exist yet in the account this is a
 * silent no-op. Best-effort: swallows its own errors so a tagging miss
 * never breaks the caller's main flow.
 */
export async function ensureContactTagByName(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  candidateNames: string[],
): Promise<void> {
  try {
    const { data: tags, error } = await db
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    if (error || !tags) return

    let tagId: string | null = null
    for (const candidate of candidateNames) {
      const match = tags.find(
        (t) => t.name.trim().toLowerCase() === candidate.toLowerCase(),
      )
      if (match) {
        tagId = match.id
        break
      }
    }
    if (!tagId) return

    const { error: upsertError } = await db.from('contact_tags').upsert(
      { contact_id: contactId, tag_id: tagId },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
    )
    if (upsertError) {
      console.error('[auto-tag] failed to link tag:', upsertError.message)
    }
  } catch (err) {
    console.error('[auto-tag] ensureContactTagByName failed:', err)
  }
}
