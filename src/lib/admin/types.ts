// ============================================================
// Admin panel — shared types + display metadata.
//
// Mirrors the `plans` / `subscriptions` schema described in the task
// brief. Kept separate from data.ts so components can import types
// without pulling in the Supabase query code.
// ============================================================

export type PlanCode = 'starter' | 'pro' | 'business'

export interface Plan {
  id: string
  code: PlanCode
  name: string
  price_per_seat_cents: number
  stripe_price_id: string | null
  is_active: boolean
  sort_order: number
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'

export interface AccountSubscription {
  id: string
  account_id: string
  plan_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: SubscriptionStatus
  seats: number
  trial_start: string | null
  trial_end: string | null
  current_period_start: string | null
  current_period_end: string | null
  canceled_at: string | null
  cancel_at_period_end: boolean
}

export interface AccountOwner {
  user_id: string
  full_name: string | null
  email: string | null
}

export interface AdminAccountRow {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  is_internal: boolean
  subscription: AccountSubscription | null
  owner: AccountOwner | null
  plan: Plan | null
  /** Count of `profiles` rows for this account — "seats used" against
   *  `subscription.seats` ("seats contracted"). */
  seatsUsed: number
  /** Owner's `auth.users.last_sign_in_at`, null if never signed in. */
  lastSignInAt: string | null
}

export interface MrrByPlanEntry {
  planId: string
  planCode: PlanCode
  planName: string
  cents: number
}

export interface MrrSummary {
  totalCents: number
  byPlan: MrrByPlanEntry[]
}

export interface ChurnSummary {
  ratePercent: number
  canceledThisMonth: number
}

export interface ExecutiveMetrics {
  /** % change in MRR vs the closest snapshot ~30 days ago. Null when
   *  there isn't a month of snapshot history yet to compare against. */
  mrrTrendPercent: number | null
  arrCents: number
  /** ARPA ÷ monthly churn rate. Null when churn is 0 (undefined, not
   *  infinite/zero) rather than implying customers never leave. */
  ltvCents: number | null
  activeCount: number
  trialingCount: number
  pastDueCount: number
  trialsExpiringSoonCount: number
}

export interface NewAccountsPoint {
  /** "YYYY-MM" */
  month: string
  count: number
}

export interface MrrSnapshotRow {
  snapshot_date: string
  mrr_cents: number
  mrr_by_plan: Record<string, number>
  total_accounts: number
  trialing_count: number
  active_count: number
  past_due_count: number
  canceled_count: number
}

/** Filter pills on the accounts table — `status: null` means "no filter". */
export const STATUS_FILTERS: {
  key: string
  label: string
  status: SubscriptionStatus | null
}[] = [
  { key: 'all', label: 'Todos', status: null },
  { key: 'trialing', label: 'Trial', status: 'trialing' },
  { key: 'active', label: 'Ativos', status: 'active' },
  { key: 'past_due', label: 'Pendentes', status: 'past_due' },
  { key: 'canceled', label: 'Cancelados', status: 'canceled' },
  { key: 'unpaid', label: 'Não pagos', status: 'unpaid' },
]

/** Badge label + color per status, for both the table and the distribution bar. */
export const STATUS_META: Record<
  SubscriptionStatus,
  { label: string; color: string }
> = {
  trialing: { label: 'Trial', color: '#60A5FA' },
  active: { label: 'Ativo', color: '#34D399' },
  past_due: { label: 'Pendente', color: '#FB923C' },
  canceled: { label: 'Cancelado', color: '#9CA3AF' },
  unpaid: { label: 'Não pago', color: '#F87171' },
  incomplete: { label: 'Incompleto', color: '#9CA3AF' },
  incomplete_expired: { label: 'Expirado', color: '#9CA3AF' },
}
