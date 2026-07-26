import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { stripe } from '@/lib/admin/stripe'

const VALID_PLAN_CODES = ['starter', 'pro', 'business'] as const
type PlanCode = (typeof VALID_PLAN_CODES)[number]

function isPlanCode(value: unknown): value is PlanCode {
  return VALID_PLAN_CODES.includes(value as PlanCode)
}

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for the caller's account to
 * subscribe (or change plans) and returns the URL to redirect to.
 * This is the customer-facing counterpart to the admin panel's manual
 * subscriptions.create/update calls in
 * .../admin/accounts/[accountId]/subscription/route.ts — that route
 * is for support acting on an account that's already set up; this one
 * is a self-serve account admin paying for the first time (or
 * upgrading) from /billing/plans.
 *
 * Deliberately does NOT write to the local `subscriptions` table —
 * Stripe doesn't consider the subscription real until the customer
 * actually completes payment on its hosted page, and that outcome
 * (plus the resulting Stripe subscription id) only reaches us via the
 * `checkout.session.completed` webhook. Writing anything here would
 * risk a local row that doesn't match what actually happened.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, account } = await requireRole('admin')

    const body = await request.json().catch(() => ({}))
    if (!isPlanCode(body.planCode)) {
      return NextResponse.json({ error: 'planCode must be starter, pro, or business' }, { status: 400 })
    }
    const seats = Number(body.seats)
    if (!Number.isInteger(seats) || seats < 1 || seats > 20) {
      return NextResponse.json({ error: 'seats must be an integer between 1 and 20' }, { status: 400 })
    }

    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, stripe_price_id')
      .eq('code', body.planCode)
      .eq('is_active', true)
      .maybeSingle()
    if (planError) {
      console.error('[billing/checkout] plan lookup failed:', planError)
      return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 })
    }
    if (!plan?.stripe_price_id) {
      return NextResponse.json({ error: 'This plan is not available for checkout' }, { status: 400 })
    }

    // Reuse the account's existing Stripe customer if it has one (e.g.
    // a past subscription that lapsed) rather than passing
    // customer_email, which would make Stripe mint a brand-new
    // Customer object with the same email — same account ends up with
    // two Customer records, splitting its payment history/portal view.
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('account_id', accountId)
      .maybeSingle()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.funilly.tech'

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: seats }],
      success_url: `${siteUrl}/dashboard?checkout=success`,
      cancel_url: `${siteUrl}/billing/plans`,
      ...(existingSub?.stripe_customer_id
        ? { customer: existingSub.stripe_customer_id }
        : { customer_email: user?.email ?? undefined }),
      metadata: {
        account_id: accountId,
        plan_code: body.planCode,
        // Not read back by the webhook today (line_items on the
        // completed session already carries quantity), but cheap
        // insurance against ever needing it without an extra Stripe
        // API round trip to expand line_items.
        seats: String(seats),
        created_by_user_id: userId,
        account_name: account.name,
      },
    })

    if (!session.url) {
      console.error('[billing/checkout] Stripe returned a session with no url:', session.id)
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url })
  } catch (err) {
    // toErrorResponse() only logs the raw `err` object and always
    // returns a generic "Internal server error" to the client (by
    // design — server internals shouldn't leak on the wire). That
    // makes a StripeError's actual reason (e.g. "No such price" when
    // STRIPE_SECRET_KEY points at a different mode/account than the
    // one the price id was created in) easy to miss in logs that
    // aren't pretty-printing nested error objects. Log the fields
    // that actually explain *why* explicitly before falling through.
    if (err instanceof Stripe.errors.StripeError) {
      console.error('[billing/checkout] Stripe error:', {
        type: err.type,
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
        requestId: err.requestId,
        param: 'param' in err ? err.param : undefined,
      })
    } else if (err instanceof Error) {
      console.error('[billing/checkout] unhandled error:', {
        name: err.name,
        message: err.message,
        stack: err.stack,
      })
    } else {
      console.error('[billing/checkout] unhandled non-Error throw:', err)
    }
    return toErrorResponse(err)
  }
}
