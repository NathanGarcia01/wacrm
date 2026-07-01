import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { getPlans } from '@/lib/admin/data'
import { hasValidCronSecret, requireAdminSession } from '@/lib/admin/require-admin'

/**
 * POST /api/admin/mrr-snapshot — computes today's MRR and upserts a
 * row into `mrr_snapshots` (idempotent on `snapshot_date`, so hitting
 * this twice in a day just recomputes the same row instead of
 * duplicating it).
 *
 * Accepts either the admin cookie (the panel's "Capturar snapshot"
 * button) or a matching `x-cron-secret` header (an external daily
 * scheduler) — mirrors GET /api/automations/cron's dual-auth shape.
 */
export async function POST(request: Request) {
  const isAdmin = await requireAdminSession()
  const isCron = hasValidCronSecret(request)
  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()

  const [{ data: subs, error: subsError }, plans, { count: totalAccounts, error: accountsError }] =
    await Promise.all([
      admin.from('subscriptions').select('plan_id, seats, status'),
      getPlans(),
      admin.from('accounts').select('id', { count: 'exact', head: true }),
    ])
  if (subsError) return NextResponse.json({ error: subsError.message }, { status: 500 })
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 })

  const plansById = new Map(plans.map((p) => [p.id, p]))

  let mrrCents = 0
  const mrrByPlan: Record<string, number> = {}
  let trialingCount = 0
  let activeCount = 0
  let pastDueCount = 0
  let canceledCount = 0

  for (const sub of subs ?? []) {
    const status = sub.status as string
    if (status === 'trialing') trialingCount++
    else if (status === 'active') activeCount++
    else if (status === 'past_due') pastDueCount++
    else if (status === 'canceled') canceledCount++

    if (status !== 'active') continue
    const plan = plansById.get(sub.plan_id as string)
    if (!plan) continue
    const cents = (sub.seats as number) * plan.price_per_seat_cents
    mrrCents += cents
    mrrByPlan[plan.code] = (mrrByPlan[plan.code] ?? 0) + cents
  }

  const snapshotDate = new Date().toISOString().slice(0, 10)

  const { error: upsertError } = await admin.from('mrr_snapshots').upsert(
    {
      snapshot_date: snapshotDate,
      mrr_cents: mrrCents,
      mrr_by_plan: mrrByPlan,
      total_accounts: totalAccounts ?? 0,
      trialing_count: trialingCount,
      active_count: activeCount,
      past_due_count: pastDueCount,
      canceled_count: canceledCount,
    },
    { onConflict: 'snapshot_date' },
  )
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    snapshot_date: snapshotDate,
    mrr_cents: mrrCents,
  })
}
