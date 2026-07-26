import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/admin/stripe'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { logSubscriptionEvent } from '@/lib/admin/log-event'

// ============================================================
// POST /api/webhooks/stripe
//
// Processes the subscription lifecycle events Checkout/the Customer
// Portal/Stripe's own dunning produce. Mirrors the security posture
// of the other two webhooks in this codebase (Meta's
// src/app/api/whatsapp/webhook/route.ts, Evolution's
// evolution-webhook/route.ts): read the raw body, verify a signature
// BEFORE parsing, fail closed (401) if the secret isn't configured or
// the signature doesn't match. Unlike those two, Stripe's own SDK
// (`stripe.webhooks.constructEvent`) does the HMAC comparison, so
// there's no hand-rolled crypto here.
//
// A previously-registered Stripe webhook endpoint already points at
// this URL in production (created before this route existed, for a
// different/unrelated set of events) — its event subscription will
// need updating in the Stripe dashboard to include the four events
// below once this ships, or none of this code ever runs in prod.
// ============================================================

function isSubscriptionStatus(value: string): value is
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired' {
  return [
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
    'incomplete_expired',
  ].includes(value)
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting request.')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.warn(
      '[stripe-webhook] signature verification failed:',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Idempotency guard — Stripe explicitly documents at-least-once
  // delivery (a slow ack, a network blip, or their own retry policy
  // can redeliver the same event id more than once), and confirmed
  // live during testing: a single `stripe listen`-forwarded delivery
  // produced two identical `stripe_checkout_completed` audit rows.
  // The `subscriptions` upsert below is naturally idempotent (same
  // event → same values), but re-running it doesn't un-write a
  // duplicate audit log entry, so dedupe explicitly on event.id before
  // doing anything else. Checks the table's own `stripe_event_id`
  // column (unique constraint from the original billing migration),
  // not a JSON payload path — logSubscriptionEvent writes it there.
  const admin = supabaseAdmin()
  const { data: alreadyProcessed } = await admin
    .from('subscription_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle()
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.id)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id)
        break
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, event.id)
        break
      default:
        // Every other event this endpoint might receive (the
        // previously-registered subscription is subscribed to a much
        // wider set — see file header) is intentionally a no-op.
        break
    }
  } catch (err) {
    console.error(`[stripe-webhook] handler for ${event.type} threw:`, err)
    // 500 (not 200) so Stripe's automatic retry actually retries —
    // swallowing this would silently leave the local subscription out
    // of sync with what Stripe actually did.
    return NextResponse.json({ error: 'Internal error processing webhook' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string) {
  const accountId = session.metadata?.account_id
  const planCode = session.metadata?.plan_code
  if (!accountId || !planCode) {
    console.error('[stripe-webhook] checkout.session.completed missing account_id/plan_code metadata:', session.id)
    return
  }
  if (session.mode !== 'subscription' || !session.subscription) {
    console.warn('[stripe-webhook] checkout.session.completed with no subscription — ignoring:', session.id)
    return
  }

  const admin = supabaseAdmin()

  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('id')
    .eq('code', planCode)
    .maybeSingle()
  if (planError || !plan) {
    console.error('[stripe-webhook] unknown plan_code in checkout metadata:', planCode, planError)
    return
  }

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription.id
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null

  // Fetch the real subscription object rather than trusting the
  // Checkout Session's own snapshot — status/period fields on the
  // session can lag the subscription by a beat, and this is the one
  // record that becomes the account's billing source of truth.
  const subscription = await stripe().subscriptions.retrieve(subscriptionId)
  const seats = subscription.items.data[0]?.quantity ?? 1
  const status = isSubscriptionStatus(subscription.status) ? subscription.status : 'active'

  const { data: existing } = await admin
    .from('subscriptions')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()

  const row = {
    account_id: accountId,
    plan_id: plan.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status,
    seats,
    trial_end: null,
    cancel_at_period_end: subscription.cancel_at_period_end,
  }

  const { error: upsertError } = existing
    ? await admin.from('subscriptions').update(row).eq('id', existing.id)
    : await admin.from('subscriptions').insert(row)
  if (upsertError) {
    console.error('[stripe-webhook] failed to write subscription after checkout:', upsertError)
    return
  }

  await logSubscriptionEvent(admin, {
    accountId,
    subscriptionId: existing?.id ?? null,
    accountName: (session.metadata?.account_name as string) ?? accountId,
    ownerEmail: session.customer_details?.email ?? null,
    eventType: 'stripe_checkout_completed',
    triggeredBy: 'stripe_webhook',
    stripeEventId: eventId,
    extra: { plan_code: planCode, seats, stripe_subscription_id: subscription.id },
  })
}

/** Shared lookup — every event past checkout.session.completed keys
 *  off stripe_subscription_id, which only exists locally once that
 *  first event has been processed. A subscription Stripe knows about
 *  but we don't (yet, or ever — e.g. a test-mode event replayed
 *  against a row that was manually deleted) is logged and skipped
 *  rather than throwing, since throwing here would make Stripe retry
 *  forever on a truly orphaned event. */
async function findLocalSubscription(stripeSubscriptionId: string) {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('subscriptions')
    .select('id, account_id, accounts(name)')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle()
  if (error) {
    console.error('[stripe-webhook] subscription lookup failed:', error)
    return null
  }
  if (!data) {
    console.warn('[stripe-webhook] no local subscription for stripe_subscription_id:', stripeSubscriptionId)
    return null
  }
  // Same object-vs-array embed ambiguity handled elsewhere in this
  // codebase (use-auth.tsx, lib/admin/data.ts) for a nested single-row
  // embed.
  const accountsEmbed = data.accounts as { name: string } | { name: string }[] | null
  const accountName = Array.isArray(accountsEmbed) ? accountsEmbed[0]?.name : accountsEmbed?.name
  return { id: data.id, account_id: data.account_id, accountName: accountName ?? data.account_id }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, eventId: string) {
  const local = await findLocalSubscription(subscription.id)
  if (!local) return

  const admin = supabaseAdmin()
  const status = isSubscriptionStatus(subscription.status) ? subscription.status : 'active'
  const seats = subscription.items.data[0]?.quantity ?? undefined
  const item = subscription.items.data[0]

  const { error } = await admin
    .from('subscriptions')
    .update({
      status,
      seats,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : undefined,
      current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : undefined,
    })
    .eq('id', local.id)
  if (error) {
    console.error('[stripe-webhook] failed to update subscription:', error)
    return
  }

  await logSubscriptionEvent(admin, {
    accountId: local.account_id,
    subscriptionId: local.id,
    accountName: local.accountName,
    ownerEmail: null,
    eventType: 'stripe_subscription_updated',
    triggeredBy: 'stripe_webhook',
    stripeEventId: eventId,
    extra: { status, seats, stripe_subscription_id: subscription.id },
  })
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, eventId: string) {
  const local = await findLocalSubscription(subscription.id)
  if (!local) return

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_at_period_end: false })
    .eq('id', local.id)
  if (error) {
    console.error('[stripe-webhook] failed to cancel subscription:', error)
    return
  }

  await logSubscriptionEvent(admin, {
    accountId: local.account_id,
    subscriptionId: local.id,
    accountName: local.accountName,
    ownerEmail: null,
    eventType: 'stripe_subscription_deleted',
    triggeredBy: 'stripe_webhook',
    stripeEventId: eventId,
    extra: { stripe_subscription_id: subscription.id },
  })
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string) {
  // Recent Stripe API versions moved this off a top-level
  // `invoice.subscription` field onto `invoice.parent.subscription_details.subscription`
  // (confirmed against the installed stripe package's own type defs —
  // `Invoice.subscription` doesn't exist any more in this API version).
  const subscriptionField = invoice.parent?.subscription_details?.subscription
  const stripeSubscriptionId =
    typeof subscriptionField === 'string' ? subscriptionField : subscriptionField?.id
  if (!stripeSubscriptionId) return // one-off invoice, not tied to a subscription

  const local = await findLocalSubscription(stripeSubscriptionId)
  if (!local) return

  const admin = supabaseAdmin()
  const { error } = await admin.from('subscriptions').update({ status: 'past_due' }).eq('id', local.id)
  if (error) {
    console.error('[stripe-webhook] failed to mark subscription past_due:', error)
    return
  }

  await logSubscriptionEvent(admin, {
    accountId: local.account_id,
    subscriptionId: local.id,
    accountName: local.accountName,
    ownerEmail: invoice.customer_email ?? null,
    eventType: 'stripe_invoice_payment_failed',
    triggeredBy: 'stripe_webhook',
    stripeEventId: eventId,
    extra: { stripe_subscription_id: stripeSubscriptionId, invoice_id: invoice.id },
  })
}
