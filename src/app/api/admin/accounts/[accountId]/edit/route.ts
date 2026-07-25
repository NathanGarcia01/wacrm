import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { logSubscriptionEvent } from '@/lib/admin/log-event'
import { requireAdminUser } from '@/lib/admin/require-admin'
import { STATUS_META, type SubscriptionStatus } from '@/lib/admin/types'

interface EditBody {
  name?: unknown
  ownerEmail?: unknown
  planId?: unknown
  status?: unknown
  trialEnd?: unknown
  isInternal?: unknown
  isActive?: unknown
  seats?: unknown
}

/**
 * PATCH /api/admin/accounts/[accountId]/edit — the consolidated
 * "Editar" modal save. Unlike the granular actions in
 * .../subscription/route.ts (which each call Stripe to keep billing
 * in sync), this is a raw DB override: it lets an owner admin fix
 * name/plan/status/trial/seats/flags directly without touching
 * Stripe, same spirit as `adjust_seats` there. Only touches fields
 * actually present in the body, so a partial save from the modal
 * doesn't clobber the rest.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const caller = await requireAdminUser()
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (caller.role !== 'owner') {
    return NextResponse.json({ error: 'Ação restrita a administradores owner' }, { status: 403 })
  }

  const { accountId } = await context.params
  const body = (await request.json().catch(() => ({}))) as EditBody

  const admin = supabaseAdmin()

  const [{ data: account, error: accountError }, { data: subscription, error: subError }] =
    await Promise.all([
      admin.from('accounts').select('id, name, owner_user_id, is_internal').eq('id', accountId).maybeSingle(),
      admin.from('subscriptions').select('id, plan_id, status, seats, trial_end').eq('account_id', accountId).maybeSingle(),
    ])
  if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 })
  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const accountUpdate: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) accountUpdate.name = body.name.trim()
  if (typeof body.isInternal === 'boolean') accountUpdate.is_internal = body.isInternal
  if (typeof body.isActive === 'boolean') accountUpdate.is_active = body.isActive

  const subUpdate: Record<string, unknown> = {}
  if (typeof body.planId === 'string' && body.planId) subUpdate.plan_id = body.planId
  if (typeof body.status === 'string' && body.status) {
    if (!(body.status in STATUS_META)) {
      return NextResponse.json({ error: 'Status inválido' }, { status: 400 })
    }
    subUpdate.status = body.status as SubscriptionStatus
  }
  if (body.trialEnd === null) {
    subUpdate.trial_end = null
  } else if (typeof body.trialEnd === 'string' && body.trialEnd) {
    const parsed = new Date(body.trialEnd)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Data de trial inválida' }, { status: 400 })
    }
    subUpdate.trial_end = parsed.toISOString()
  }
  if (body.seats !== undefined) {
    const seatsNum = Number(body.seats)
    if (!Number.isFinite(seatsNum) || seatsNum < 1) {
      return NextResponse.json({ error: 'Quantidade de seats inválida' }, { status: 400 })
    }
    subUpdate.seats = seatsNum
  }

  const ownerEmailUpdate = typeof body.ownerEmail === 'string' && body.ownerEmail.trim()
    ? body.ownerEmail.trim().toLowerCase()
    : null

  if (
    Object.keys(accountUpdate).length === 0 &&
    Object.keys(subUpdate).length === 0 &&
    !ownerEmailUpdate
  ) {
    return NextResponse.json({ error: 'Nada para salvar' }, { status: 400 })
  }

  if (Object.keys(accountUpdate).length > 0) {
    const { error } = await admin.from('accounts').update(accountUpdate).eq('id', accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (Object.keys(subUpdate).length > 0) {
    if (subscription) {
      const { error } = await admin.from('subscriptions').update(subUpdate).eq('id', subscription.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // No subscription row yet (shouldn't happen for new signups after
      // the trial-on-signup migration, but older/edge-case accounts may
      // still lack one) — create it from whatever fields were given,
      // same DB-only spirit as the rest of this route.
      if (!subUpdate.plan_id) {
        return NextResponse.json(
          { error: 'Esta conta ainda não tem subscription — selecione um plano para criar uma' },
          { status: 400 },
        )
      }
      const { error } = await admin.from('subscriptions').insert({
        account_id: accountId,
        plan_id: subUpdate.plan_id,
        status: subUpdate.status ?? 'trialing',
        seats: subUpdate.seats ?? 1,
        trial_end: subUpdate.trial_end ?? null,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // Owner email — display/contact record only (profiles.email), not
  // auth.users. Changing the login email is a separate, more sensitive
  // action (would need Supabase auth's confirmation flow) and is
  // deliberately out of scope for this admin override.
  if (ownerEmailUpdate) {
    const { error } = await admin
      .from('profiles')
      .update({ email: ownerEmailUpdate })
      .eq('account_id', accountId)
      .eq('user_id', account.owner_user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('user_id', account.owner_user_id)
    .maybeSingle()

  await logSubscriptionEvent(admin, {
    accountId,
    subscriptionId: subscription?.id ?? null,
    accountName: (accountUpdate.name as string | undefined) ?? account.name,
    ownerEmail: (ownerProfile?.email as string | undefined) ?? null,
    eventType: 'admin_action_edit_account',
    extra: { account_changes: accountUpdate, subscription_changes: subUpdate, owner_email_changed: Boolean(ownerEmailUpdate) },
  })

  return NextResponse.json({ ok: true })
}
