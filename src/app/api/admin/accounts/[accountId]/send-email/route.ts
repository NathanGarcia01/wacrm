// ============================================================
// POST /api/admin/accounts/[accountId]/send-email
//
// Lets an admin send a one-off free-text email to an account's owner
// straight from the admin panel (e.g. a billing follow-up). Reuses
// the Resend integration from src/lib/email/resend-client.ts and the
// same table-based HTML template pattern as the welcome email.
// Logs a subscription_events row so it shows up in the account's
// event history alongside billing actions.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { logSubscriptionEvent } from '@/lib/admin/log-event'
import { requireAdminSession } from '@/lib/admin/require-admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getResendClient, getWelcomeEmailFrom } from '@/lib/email/resend-client'
import { adminMessageEmailHtml } from '@/lib/email/templates/admin-message-email'

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { accountId } = await context.params

  // Keyed per-account (not per-IP) — this bounds how often ANY admin
  // can email a given customer, which is the thing actually worth
  // rate-limiting here (accidental double-click / repeated sends to
  // the same person), independent of who's logged into the panel.
  const limit = checkRateLimit(`admin-send-email:${accountId}`, RATE_LIMITS.adminAction)
  if (!limit.success) return rateLimitResponse(limit)

  const body = await request.json().catch(() => ({}))
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!subject || !message) {
    return NextResponse.json({ error: 'subject e message são obrigatórios' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id, name, owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('user_id', account.owner_user_id)
    .maybeSingle()
  const ownerEmail = (ownerProfile?.email as string | undefined) ?? null
  if (!ownerEmail) {
    return NextResponse.json({ error: 'Owner sem email cadastrado' }, { status: 400 })
  }

  const resend = getResendClient()
  if (!resend) {
    return NextResponse.json({ error: 'RESEND_API_KEY não configurada' }, { status: 503 })
  }

  try {
    await resend.emails.send({
      from: getWelcomeEmailFrom(),
      to: ownerEmail,
      subject,
      html: adminMessageEmailHtml({ subject, message }),
    })
  } catch (err) {
    const messageText = err instanceof Error ? err.message : 'Falha ao enviar email'
    return NextResponse.json({ error: messageText }, { status: 500 })
  }

  await logSubscriptionEvent(admin, {
    accountId,
    accountName: account.name,
    ownerEmail,
    eventType: 'admin_email_sent',
    extra: { subject },
  })

  return NextResponse.json({ ok: true })
}
