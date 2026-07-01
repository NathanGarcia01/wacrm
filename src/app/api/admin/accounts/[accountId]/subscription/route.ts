import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { requireAdminSession } from '@/lib/admin/require-admin'
import { stripe } from '@/lib/admin/stripe'

type ActionKey =
  | 'cancel_at_period_end'
  | 'cancel_immediately'
  | 'undo_cancel'
  | 'create_portal_link'
  | 'recreate'

interface SubscriptionRow {
  id: string
  account_id: string
  plan_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string
  seats: number
  cancel_at_period_end: boolean
}

/**
 * PATCH /api/admin/accounts/[accountId]/subscription — every admin
 * billing action (cancel / undo / portal link / recreate) funnels
 * through here. Each branch: calls Stripe, mirrors the result back
 * onto the local `subscriptions` row (no webhook wiring in this
 * panel yet, so the DB write happens inline), then logs a
 * `subscription_events` row so there's an audit trail of who did
 * what from the admin panel.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { accountId } = await context.params
  const body = await request.json().catch(() => ({}))
  const action = body.action as ActionKey | undefined
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const [{ data: account, error: accountError }, { data: subscription, error: subError }] =
    await Promise.all([
      admin.from('accounts').select('id, name, owner_user_id').eq('id', accountId).maybeSingle(),
      admin
        .from('subscriptions')
        .select(
          'id, account_id, plan_id, stripe_customer_id, stripe_subscription_id, status, seats, cancel_at_period_end',
        )
        .eq('account_id', accountId)
        .maybeSingle(),
    ])
  if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 })
  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  if (!subscription) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('user_id', account.owner_user_id)
    .maybeSingle()
  const ownerEmail = (ownerProfile?.email as string | undefined) ?? null

  const logEvent = async (eventType: string, extra: Record<string, unknown> = {}) => {
    await admin.from('subscription_events').insert({
      subscription_id: subscription.id,
      account_id: accountId,
      event_type: eventType,
      payload: {
        triggered_by: 'admin_panel',
        account_name: account.name,
        owner_email: ownerEmail,
        ...extra,
      },
      processed_at: new Date().toISOString(),
    })
  }

  try {
    switch (action) {
      case 'cancel_at_period_end':
        return await handleCancelAtPeriodEnd(subscription, logEvent)
      case 'cancel_immediately':
        return await handleCancelImmediately(subscription, logEvent)
      case 'undo_cancel':
        return await handleUndoCancel(subscription, logEvent)
      case 'create_portal_link':
        return await handleCreatePortalLink(subscription, logEvent)
      case 'recreate':
        return await handleRecreate(subscription, logEvent)
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe request failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function requireStripeSubscriptionId(sub: SubscriptionRow): string {
  if (!sub.stripe_subscription_id) {
    throw new Error('This subscription has no linked Stripe subscription id')
  }
  return sub.stripe_subscription_id
}

async function handleCancelAtPeriodEnd(
  sub: SubscriptionRow,
  logEvent: (type: string, extra?: Record<string, unknown>) => Promise<unknown>,
) {
  const stripeId = requireStripeSubscriptionId(sub)
  await stripe().subscriptions.update(stripeId, { cancel_at_period_end: true })

  const admin = supabaseAdmin()
  await admin.from('subscriptions').update({ cancel_at_period_end: true }).eq('id', sub.id)
  await logEvent('admin_action_cancel_at_period_end')

  return NextResponse.json({ ok: true })
}

async function handleCancelImmediately(
  sub: SubscriptionRow,
  logEvent: (type: string, extra?: Record<string, unknown>) => Promise<unknown>,
) {
  const stripeId = requireStripeSubscriptionId(sub)
  await stripe().subscriptions.cancel(stripeId)

  const admin = supabaseAdmin()
  const now = new Date().toISOString()
  await admin
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: now, cancel_at_period_end: false })
    .eq('id', sub.id)
  await logEvent('admin_action_cancel_immediately')

  return NextResponse.json({ ok: true })
}

async function handleUndoCancel(
  sub: SubscriptionRow,
  logEvent: (type: string, extra?: Record<string, unknown>) => Promise<unknown>,
) {
  const stripeId = requireStripeSubscriptionId(sub)
  await stripe().subscriptions.update(stripeId, { cancel_at_period_end: false })

  const admin = supabaseAdmin()
  await admin.from('subscriptions').update({ cancel_at_period_end: false }).eq('id', sub.id)
  await logEvent('admin_action_undo_cancel')

  return NextResponse.json({ ok: true })
}

async function handleCreatePortalLink(
  sub: SubscriptionRow,
  logEvent: (type: string, extra?: Record<string, unknown>) => Promise<unknown>,
) {
  if (!sub.stripe_customer_id) {
    throw new Error('This account has no linked Stripe customer id')
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const session = await stripe().billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${siteUrl}/dashboard`,
  })
  await logEvent('admin_action_create_portal_link')

  return NextResponse.json({ ok: true, url: session.url })
}

async function handleRecreate(
  sub: SubscriptionRow,
  logEvent: (type: string, extra?: Record<string, unknown>) => Promise<unknown>,
) {
  const admin = supabaseAdmin()

  let existing: Stripe.Subscription | null = null
  if (sub.stripe_subscription_id) {
    try {
      existing = await stripe().subscriptions.retrieve(sub.stripe_subscription_id)
    } catch {
      existing = null
    }
  }

  if (existing && existing.status !== 'canceled') {
    // Still alive on Stripe's side (e.g. scheduled cancel_at_period_end
    // that hasn't hit yet) — just undo the cancel flag instead of
    // creating a duplicate subscription.
    const updated = await stripe().subscriptions.update(existing.id, {
      cancel_at_period_end: false,
    })
    await admin
      .from('subscriptions')
      .update({
        status: updated.status,
        cancel_at_period_end: false,
        canceled_at: null,
      })
      .eq('id', sub.id)
    await logEvent('admin_action_recreate', { mode: 'undo_cancel' })
    return NextResponse.json({ ok: true, mode: 'undo_cancel' })
  }

  // Truly gone (or never existed) — spin up a fresh subscription for
  // the same customer + plan.
  if (!sub.stripe_customer_id) {
    throw new Error('This account has no linked Stripe customer id — cannot recreate')
  }
  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('stripe_price_id')
    .eq('id', sub.plan_id)
    .maybeSingle()
  if (planError) throw new Error(planError.message)
  if (!plan?.stripe_price_id) {
    throw new Error('This plan has no linked Stripe price id — cannot recreate')
  }

  const created = await stripe().subscriptions.create({
    customer: sub.stripe_customer_id,
    items: [{ price: plan.stripe_price_id, quantity: sub.seats }],
  })

  await admin
    .from('subscriptions')
    .update({
      stripe_subscription_id: created.id,
      status: created.status,
      cancel_at_period_end: false,
      canceled_at: null,
    })
    .eq('id', sub.id)
  await logEvent('admin_action_recreate', { mode: 'new_subscription', stripe_subscription_id: created.id })

  return NextResponse.json({ ok: true, mode: 'new_subscription' })
}
