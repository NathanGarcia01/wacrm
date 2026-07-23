// ============================================================
// Admin panel — read queries. Always uses supabaseAdmin() (service
// role) since the admin panel has its own auth domain (see
// lib/admin/auth.ts) and intentionally bypasses per-account RLS.
//
// FK-qualified embeds throughout: this schema has 20+ tables with an
// `account_id` FK into `accounts`, so embeds always name the exact
// constraint (`subscriptions!subscriptions_account_id_fkey`, etc.)
// rather than relying on PostgREST to infer the relationship.
// ============================================================

import { supabaseAdmin } from './admin-client'
import type {
  AccountSubscription,
  AccountUsageStats,
  AdminAccountRow,
  ChurnSummary,
  ExecutiveMetrics,
  MrrSnapshotRow,
  MrrSummary,
  NewAccountsPoint,
  Plan,
  SubscriptionEventRow,
  SubscriptionStatus,
} from './types'

export const ACCOUNTS_PAGE_SIZE = 50

export async function getPlans(): Promise<Plan[]> {
  const { data, error } = await supabaseAdmin()
    .from('plans')
    .select('id, code, name, price_per_seat_cents, stripe_price_id, is_active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Plan[]
}

interface AccountsPageResult {
  rows: AdminAccountRow[]
  total: number
  pageSize: number
}

export interface AccountsFilterOptions {
  /** Matches against owner `full_name` or `email` (ilike, two
   *  separate queries merged in JS — see getAccountsPage). */
  search?: string
  planId?: string
  /** Narrows to `status='trialing'` accounts whose `trial_end` falls
   *  within the next N days. */
  trialExpiringWithinDays?: number
  /** `accounts.created_at >=` this ISO date. */
  createdFrom?: string
  /** `accounts.created_at <=` this ISO date. */
  createdTo?: string
}

interface RawAccountRow {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  is_internal: boolean
  // account_id is UNIQUE on subscriptions, so PostgREST returns a
  // single object (or null) here, never an array — don't index [0].
  subscriptions: AccountSubscription | null
  profiles: { user_id: string; full_name: string | null; email: string | null; account_role: string }[] | null
}

/** Shapes one raw embedded-query row into the panel's `AdminAccountRow`
 *  — shared by the list page and (Phase D) the account detail page so
 *  both produce identically-shaped data from one code path. */
function shapeAccountRow(
  r: RawAccountRow,
  plansById: Map<string, Plan>,
  lastSignInByUserId: Map<string, string | null>,
): AdminAccountRow {
  const sub = r.subscriptions
  const profiles = r.profiles ?? []
  const owner =
    profiles.find((p) => p.user_id === r.owner_user_id) ??
    profiles.find((p) => p.account_role === 'owner') ??
    null

  return {
    id: r.id,
    name: r.name,
    owner_user_id: r.owner_user_id,
    created_at: r.created_at,
    is_internal: r.is_internal,
    subscription: sub,
    owner: owner ? { user_id: owner.user_id, full_name: owner.full_name, email: owner.email } : null,
    plan: sub ? (plansById.get(sub.plan_id) ?? null) : null,
    seatsUsed: profiles.length,
    lastSignInAt: lastSignInByUserId.get(r.owner_user_id) ?? null,
  }
}

/**
 * `auth.users.last_sign_in_at` for a batch of owner ids — the natural
 * "último acesso" source since Supabase already tracks it natively,
 * no app-side activity table needed. One Admin API call per distinct
 * id (no bulk "getUsersByIds" in supabase-js); fine at panel scale
 * (≤50 rows/page). If this ever needs to scale further, cache the
 * value in a column synced by the same cron that runs mrr-snapshot.
 */
export async function getLastSignInAtByUserIds(
  userIds: string[],
): Promise<Map<string, string | null>> {
  const admin = supabaseAdmin()
  const uniqueIds = [...new Set(userIds)]
  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id)
        if (error || !data?.user) return [id, null] as const
        return [id, data.user.last_sign_in_at ?? null] as const
      } catch {
        return [id, null] as const
      }
    }),
  )
  return new Map(results)
}

/**
 * Page of accounts + their subscription/owner, newest first.
 * `filterStatus` (a `subscriptions.status` value) restricts to
 * accounts whose subscription has that status — implemented with the
 * `!inner` join hint so the filter narrows the parent `accounts` rows
 * too, not just the embedded subscription. `options` layers on top:
 * plan and trial-expiring filters share the same `!inner` embed
 * (composable with `filterStatus` since they all target the same
 * `subscriptions` relation); search and date-range filter `accounts`
 * directly.
 */
export async function getAccountsPage(
  page: number,
  filterStatus: SubscriptionStatus | null,
  options: AccountsFilterOptions = {},
): Promise<AccountsPageResult> {
  const admin = supabaseAdmin()
  const from = (page - 1) * ACCOUNTS_PAGE_SIZE
  const to = from + ACCOUNTS_PAGE_SIZE - 1

  const needsSubscriptionInner = Boolean(
    filterStatus || options.planId || options.trialExpiringWithinDays,
  )
  const subscriptionEmbed = needsSubscriptionInner
    ? 'subscriptions!subscriptions_account_id_fkey!inner(*)'
    : 'subscriptions!subscriptions_account_id_fkey(*)'

  let query = admin
    .from('accounts')
    .select(
      `id, name, owner_user_id, created_at, is_internal, ${subscriptionEmbed}, profiles!profiles_account_id_fkey(user_id, full_name, email, account_role)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })

  if (filterStatus) {
    query = query.eq('subscriptions.status', filterStatus)
  }
  if (options.planId) {
    query = query.eq('subscriptions.plan_id', options.planId)
  }
  if (options.trialExpiringWithinDays) {
    const now = new Date().toISOString()
    const cutoff = new Date(
      Date.now() + options.trialExpiringWithinDays * 24 * 60 * 60 * 1000,
    ).toISOString()
    query = query
      .eq('subscriptions.status', 'trialing')
      .gte('subscriptions.trial_end', now)
      .lte('subscriptions.trial_end', cutoff)
  }
  if (options.createdFrom) {
    query = query.gte('created_at', options.createdFrom)
  }
  if (options.createdTo) {
    query = query.lte('created_at', options.createdTo)
  }

  // Search by owner name/email: two simple ilike queries merged in JS
  // rather than one `.or()` string — avoids having to escape commas/
  // parens out of arbitrary admin-typed input for PostgREST's filter
  // grammar.
  if (options.search?.trim()) {
    const likeQ = `%${options.search.trim()}%`
    const [{ data: byName, error: nameError }, { data: byEmail, error: emailError }] =
      await Promise.all([
        admin.from('profiles').select('account_id').ilike('full_name', likeQ),
        admin.from('profiles').select('account_id').ilike('email', likeQ),
      ])
    if (nameError) throw new Error(nameError.message)
    if (emailError) throw new Error(emailError.message)
    const accountIds = [
      ...new Set(
        [...(byName ?? []), ...(byEmail ?? [])]
          .map((r) => r.account_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    if (accountIds.length === 0) {
      return { rows: [], total: 0, pageSize: ACCOUNTS_PAGE_SIZE }
    }
    query = query.in('id', accountIds)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw new Error(error.message)

  const plans = await getPlans()
  const plansById = new Map(plans.map((p) => [p.id, p]))

  const rawRows = (data ?? []) as unknown as RawAccountRow[]
  const lastSignInByUserId = await getLastSignInAtByUserIds(
    rawRows.map((r) => r.owner_user_id),
  )

  const rows: AdminAccountRow[] = rawRows.map((r) =>
    shapeAccountRow(r, plansById, lastSignInByUserId),
  )

  return { rows, total: count ?? 0, pageSize: ACCOUNTS_PAGE_SIZE }
}

/** Count of subscriptions per status, across ALL accounts (unpaginated) — feeds the distribution bar. */
export async function getStatusDistribution(): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin().from('subscriptions').select('status')
  if (error) throw new Error(error.message)
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const status = row.status as string
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

/**
 * MRR = Σ(seats × price_per_seat_cents) over subscriptions with
 * status='active'. Plans are fetched in a separate query and joined
 * in JS via `plansById` — avoids a triple-nested embed
 * (subscriptions → plans → accounts) that tends to fail silently
 * against this schema's FK fan-out.
 */
export async function getMrrSummary(): Promise<MrrSummary> {
  const admin = supabaseAdmin()
  const [{ data: subs, error: subsError }, plans] = await Promise.all([
    admin.from('subscriptions').select('plan_id, seats').eq('status', 'active'),
    getPlans(),
  ])
  if (subsError) throw new Error(subsError.message)

  const plansById = new Map(plans.map((p) => [p.id, p]))
  const byPlanCents = new Map<string, number>()
  let totalCents = 0

  for (const s of subs ?? []) {
    const plan = plansById.get(s.plan_id as string)
    if (!plan) continue
    const cents = (s.seats as number) * plan.price_per_seat_cents
    totalCents += cents
    byPlanCents.set(plan.id, (byPlanCents.get(plan.id) ?? 0) + cents)
  }

  const byPlan = plans
    .filter((p) => byPlanCents.has(p.id))
    .map((p) => ({
      planId: p.id,
      planCode: p.code,
      planName: p.name,
      cents: byPlanCents.get(p.id)!,
    }))
    .sort((a, b) => b.cents - a.cents)

  return { totalCents, byPlan }
}

/**
 * Rough current-month churn: cancellations recorded this month over
 * (currently-active + cancellations this month) — an approximation
 * of "accounts that were active at some point this month", since we
 * don't keep a start-of-month active snapshot to divide against.
 */
export async function getChurnSummary(): Promise<ChurnSummary> {
  const admin = supabaseAdmin()
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const [
    { count: canceledCount, error: canceledError },
    { count: activeCount, error: activeError },
  ] = await Promise.all([
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'canceled')
      .gte('canceled_at', monthStart),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ])
  if (canceledError) throw new Error(canceledError.message)
  if (activeError) throw new Error(activeError.message)

  const canceled = canceledCount ?? 0
  const active = activeCount ?? 0
  const cohort = active + canceled
  const ratePercent = cohort > 0 ? (canceled / cohort) * 100 : 0

  return { ratePercent, canceledThisMonth: canceled }
}

export async function getMrrSnapshots(): Promise<MrrSnapshotRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('mrr_snapshots')
    .select(
      'snapshot_date, mrr_cents, mrr_by_plan, total_accounts, trialing_count, active_count, past_due_count, canceled_count',
    )
    .order('snapshot_date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MrrSnapshotRow[]
}

/**
 * Pure — combines data the page already fetches for the existing
 * cards (no extra Supabase round-trip) into the executive-dashboard
 * numbers. `trialsExpiringSoonCount` is the one piece that needs its
 * own query (see `getTrialsExpiringSoonCount`) since it's not
 * derivable from the other four.
 */
export function computeExecutiveMetrics(
  mrr: MrrSummary,
  churn: ChurnSummary,
  distribution: Record<string, number>,
  snapshots: MrrSnapshotRow[],
  trialsExpiringSoonCount: number,
): ExecutiveMetrics {
  const activeCount = distribution['active'] ?? 0
  const trialingCount = distribution['trialing'] ?? 0
  const pastDueCount = distribution['past_due'] ?? 0

  const arrCents = mrr.totalCents * 12

  const arpaCents = activeCount > 0 ? mrr.totalCents / activeCount : 0
  const churnFraction = churn.ratePercent / 100
  // Undefined (not 0) LTV when there's no churn data yet — a real
  // number here would imply "customers never leave," which is a
  // claim we can't back with a 0-in-the-cohort churn rate.
  const ltvCents = churnFraction > 0 ? Math.round(arpaCents / churnFraction) : null

  // MRR trend vs ~30 days ago: closest snapshot at or before that
  // date. Requires a snapshot old enough to compare against — with
  // less than a month of history this stays null rather than
  // comparing against, say, yesterday and calling it "monthly."
  let mrrTrendPercent: number | null = null
  const targetMs = Date.now() - 30 * 24 * 60 * 60 * 1000
  let closest: MrrSnapshotRow | null = null
  let closestDiff = Infinity
  for (const s of snapshots) {
    const snapshotMs = new Date(s.snapshot_date).getTime()
    if (snapshotMs > targetMs) continue
    const diff = targetMs - snapshotMs
    if (diff < closestDiff) {
      closest = s
      closestDiff = diff
    }
  }
  if (closest && closest.mrr_cents > 0) {
    mrrTrendPercent = ((mrr.totalCents - closest.mrr_cents) / closest.mrr_cents) * 100
  }

  return {
    mrrTrendPercent,
    arrCents,
    ltvCents,
    activeCount,
    trialingCount,
    pastDueCount,
    trialsExpiringSoonCount,
  }
}

/** Count-only — feeds the "Em trial" KPI tile's countdown sub-line.
 *  The full account rows for the same window are fetched separately
 *  by `getTrialsExpiringSoon` for the alert card, which needs more
 *  than a count. */
export async function getTrialsExpiringSoonCount(days: number): Promise<number> {
  const admin = supabaseAdmin()
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await admin
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'trialing')
    .gte('trial_end', now)
    .lte('trial_end', cutoff)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * New accounts per calendar month for the last `months` months
 * (default 12), including empty months so the bar chart doesn't
 * silently skip a month with zero signups. Scans `accounts.created_at`
 * and buckets in JS — fine at current scale; move to a `date_trunc`
 * RPC if the accounts table grows into the tens of thousands.
 */
export async function getNewAccountsPerMonth(months = 12): Promise<NewAccountsPoint[]> {
  const admin = supabaseAdmin()
  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - (months - 1))
  since.setUTCDate(1)
  since.setUTCHours(0, 0, 0, 0)

  const { data, error } = await admin
    .from('accounts')
    .select('created_at')
    .gte('created_at', since.toISOString())
  if (error) throw new Error(error.message)

  const counts = new Map<string, number>()
  for (let i = 0; i < months; i++) {
    const d = new Date(since)
    d.setUTCMonth(d.getUTCMonth() + i)
    counts.set(monthKey(d), 0)
  }
  for (const row of data ?? []) {
    const key = monthKey(new Date(row.created_at as string))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()].map(([month, count]) => ({ month, count }))
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Single account for the detail page — same embed/shaping as
 *  getAccountsPage, just narrowed to one row instead of a page. */
export async function getAccountById(accountId: string): Promise<AdminAccountRow | null> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('accounts')
    .select(
      'id, name, owner_user_id, created_at, is_internal, subscriptions!subscriptions_account_id_fkey(*), profiles!profiles_account_id_fkey(user_id, full_name, email, account_role)',
    )
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  const plans = await getPlans()
  const plansById = new Map(plans.map((p) => [p.id, p]))
  const raw = data as unknown as RawAccountRow
  const lastSignInByUserId = await getLastSignInAtByUserIds([raw.owner_user_id])

  return shapeAccountRow(raw, plansById, lastSignInByUserId)
}

const EVENTS_PAGE_SIZE = 30

/**
 * `subscription_events` isn't only admin-panel actions — it also
 * carries raw Stripe webhook payloads (event_type values like
 * `setup_intent.setup_failed`, full Stripe object as payload), so the
 * shape of `payload` varies a lot row to row. The caller renders it
 * generically (event_type + date + a raw payload disclosure) rather
 * than assuming a fixed shape.
 */
export async function getSubscriptionEvents(
  accountId: string,
  page = 1,
): Promise<{ rows: SubscriptionEventRow[]; total: number; pageSize: number }> {
  const admin = supabaseAdmin()
  const from = (page - 1) * EVENTS_PAGE_SIZE
  const to = from + EVENTS_PAGE_SIZE - 1

  const { data, error, count } = await admin
    .from('subscription_events')
    .select('id, event_type, payload, processed_at', { count: 'exact' })
    .eq('account_id', accountId)
    .order('processed_at', { ascending: false, nullsFirst: false })
    .range(from, to)
  if (error) throw new Error(error.message)

  return {
    rows: (data ?? []) as SubscriptionEventRow[],
    total: count ?? 0,
    pageSize: EVENTS_PAGE_SIZE,
  }
}

/**
 * Usage counts for the account detail page. `conversations`/
 * `broadcasts`/`deals` carry `account_id` directly (migration 017);
 * `messages` doesn't, so it's counted via an inner join on
 * `conversations` — verified against the live schema before relying
 * on it (this table's columns aren't in any checked-in migration).
 */
export async function getAccountUsageStats(accountId: string): Promise<AccountUsageStats> {
  const admin = supabaseAdmin()
  const [
    { count: conversations, error: convError },
    { count: broadcasts, error: bcError },
    { count: deals, error: dealsError },
    { count: messages, error: msgError },
  ] = await Promise.all([
    admin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
    admin.from('broadcasts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    admin.from('deals').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    admin
      .from('messages')
      .select('id, conversations!inner(account_id)', { count: 'exact', head: true })
      .eq('conversations.account_id', accountId),
  ])
  if (convError) throw new Error(convError.message)
  if (bcError) throw new Error(bcError.message)
  if (dealsError) throw new Error(dealsError.message)
  if (msgError) throw new Error(msgError.message)

  return {
    conversations: conversations ?? 0,
    messages: messages ?? 0,
    broadcasts: broadcasts ?? 0,
    deals: deals ?? 0,
  }
}

export interface AccountMember {
  user_id: string
  full_name: string | null
  email: string | null
  account_role: string
}

/** Full member list for the account detail page — `shapeAccountRow`
 *  only keeps the owner out of this same `profiles` embed, since the
 *  list view has no room to show everyone. */
export async function getAccountMembers(accountId: string): Promise<AccountMember[]> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('profiles')
    .select('user_id, full_name, email, account_role')
    .eq('account_id', accountId)
    .order('account_role', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AccountMember[]
}
