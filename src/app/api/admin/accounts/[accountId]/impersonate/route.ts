// ============================================================
// POST /api/admin/accounts/[accountId]/impersonate
//
// "Acessar como este cliente" — generates a Supabase magic link for
// the account owner and hands the action_link back to the admin to
// open. Deliberately the native Supabase mechanism rather than a
// bespoke impersonation-token system: no new table, no expiry
// sweeping to build, and it already does exactly what's needed.
//
// Security notes:
//   - Never persist the action_link itself anywhere (not in
//     subscription_events, not in logs) — it's a bearer credential
//     that signs in as the customer. Only who/when is logged.
//   - Opening the link replaces whatever session is active in that
//     browser profile with the customer's — the caller is expected to
//     use a private window (the button surfaces this warning).
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { logSubscriptionEvent } from '@/lib/admin/log-event'
import { requireAdminUser } from '@/lib/admin/require-admin'

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const caller = await requireAdminUser()
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Signing in as a customer is the single most sensitive action in
  // this panel — owner-only, no exceptions.
  if (caller.role !== 'owner') {
    return NextResponse.json({ error: 'Ação restrita a administradores owner' }, { status: 403 })
  }

  const { accountId } = await context.params
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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: ownerEmail,
    options: { redirectTo: `${siteUrl}/dashboard` },
  })
  if (error || !data?.properties?.action_link) {
    return NextResponse.json({ error: error?.message ?? 'Falha ao gerar link' }, { status: 500 })
  }

  await logSubscriptionEvent(admin, {
    accountId,
    accountName: account.name,
    ownerEmail,
    eventType: 'admin_impersonation_started',
  })

  return NextResponse.json({ ok: true, actionLink: data.properties.action_link })
}
