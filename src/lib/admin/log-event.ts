import type { SupabaseClient } from '@supabase/supabase-js'

interface LogSubscriptionEventParams {
  accountId: string
  /** Null when the action isn't tied to a subscription row (e.g.
   *  granting `is_internal` on an account with no billing yet). */
  subscriptionId?: string | null
  accountName: string
  ownerEmail: string | null
  eventType: string
  extra?: Record<string, unknown>
}

/**
 * Shared `subscription_events` insert — every admin action across
 * every admin route logs through here so there's one audit-trail
 * shape instead of a copy-pasted insert per route file.
 */
export async function logSubscriptionEvent(
  admin: SupabaseClient,
  { accountId, subscriptionId, accountName, ownerEmail, eventType, extra = {} }: LogSubscriptionEventParams,
): Promise<void> {
  await admin.from('subscription_events').insert({
    subscription_id: subscriptionId ?? null,
    account_id: accountId,
    event_type: eventType,
    payload: {
      triggered_by: 'admin_panel',
      account_name: accountName,
      owner_email: ownerEmail,
      ...extra,
    },
    processed_at: new Date().toISOString(),
  })
}
