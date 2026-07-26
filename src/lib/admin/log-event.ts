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
  /** Who/what caused this event. Defaults to 'admin_panel' since every
   *  call site until src/app/api/webhooks/stripe/route.ts was an admin
   *  action — that route passes 'stripe_webhook' so the audit trail
   *  doesn't misattribute a customer's own checkout/cancellation to an
   *  admin click that never happened. */
  triggeredBy?: string
  /** Stripe event id, for webhook-triggered rows only. Written to the
   *  table's own `stripe_event_id` column (which already carries a
   *  unique constraint from the original billing migration) rather
   *  than into `payload` — that column, not a JSON path, is what the
   *  webhook route's idempotency check and unique-violation fallback
   *  rely on. */
  stripeEventId?: string
}

/**
 * Shared `subscription_events` insert — every admin action across
 * every admin route logs through here so there's one audit-trail
 * shape instead of a copy-pasted insert per route file.
 *
 * Deliberately doesn't check the insert's own `error` (matches this
 * function's original behavior) — audit logging must never fail the
 * real action it's describing, which by this point has already
 * happened (Stripe call made, `subscriptions` row written). This is
 * also what makes the table's unique constraint on `stripe_event_id`
 * work as an idempotency guard for free: when the Stripe webhook calls
 * this twice for the same event (confirmed happening in practice — a
 * near-simultaneous double invocation in Next dev, and Stripe's own
 * documented at-least-once delivery, can both redeliver the same
 * event), the second insert's unique_violation is just another error
 * this function already silently tolerates, same as any other insert
 * failure.
 */
export async function logSubscriptionEvent(
  admin: SupabaseClient,
  {
    accountId,
    subscriptionId,
    accountName,
    ownerEmail,
    eventType,
    extra = {},
    triggeredBy = 'admin_panel',
    stripeEventId,
  }: LogSubscriptionEventParams,
): Promise<void> {
  await admin.from('subscription_events').insert({
    subscription_id: subscriptionId ?? null,
    account_id: accountId,
    event_type: eventType,
    stripe_event_id: stripeEventId ?? null,
    payload: {
      triggered_by: triggeredBy,
      account_name: accountName,
      owner_email: ownerEmail,
      ...extra,
    },
    processed_at: new Date().toISOString(),
  })
}
