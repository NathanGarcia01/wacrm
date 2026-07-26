import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { stripe } from '@/lib/admin/stripe'

/**
 * GET /api/billing/portal
 *
 * Self-serve counterpart to the admin panel's `create_portal_link`
 * action (.../admin/accounts/[accountId]/subscription/route.ts) — that
 * one hands an admin a URL to copy/paste to a customer; this one
 * redirects the customer themselves straight into their own Stripe
 * Customer Portal (manage card, view invoices, cancel). Linked from
 * Settings as "Gerenciar assinatura".
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[billing/portal] subscription lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load subscription' }, { status: 500 })
    }
    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'This account has no billing history yet — subscribe first at /billing/plans.' },
        { status: 400 },
      )
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.funilly.tech'
    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${siteUrl}/settings?tab=billing`,
    })

    return NextResponse.redirect(session.url)
  } catch (err) {
    return toErrorResponse(err)
  }
}
