// ============================================================
// Owner resolution for API-v1 writes.
//
// `contacts.user_id`, `deals.user_id` and `tags.user_id` are legacy
// NOT NULL "owner" columns predating multi-user accounts. A public-
// API caller authenticates with a key, not a user session, so there's
// no natural `auth.uid()` to put there — we fall back to whoever
// minted the key, then to the account owner if that member was later
// removed. Mirrors `src/lib/leads/capture.ts`'s `resolveOwnerId`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveApiOwnerId(
  db: SupabaseClient,
  accountId: string,
  createdBy: string | null,
): Promise<string | null> {
  if (createdBy) return createdBy;
  const { data } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('account_role', 'owner')
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}
