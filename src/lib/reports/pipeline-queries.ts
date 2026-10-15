import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './paginate'
import type {
  CampaignConversionRow,
  CommissionAgentRow,
  DealReportRow,
  DealsPerDayPoint,
  LossReasonPoint,
  PeriodRange,
  PipelineDailySparkPoint,
  PipelineFunnelStage,
  PipelineReportBundle,
  PipelineReportCards,
  PipelineStageMeta,
  SalesGoal,
  SourceConversionRow,
} from './types'

type DB = SupabaseClient

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface RpcCards {
  deals_created: number
  deals_won: number
  deals_lost: number
  value_won: number | null
  avg_ticket: number | null
  avg_close_days: number | null
  commission_won: number | null
  commission_projected: number | null
}

interface RpcResult {
  cards: RpcCards
  avg_time_to_win_days: number | null
  funnel: { stage_id: string; name: string; color: string; position: number; count: number }[]
  deals_per_day: { date: string; won: number }[]
  commission_by_agent: { profile_id: string; name: string; commission_won: number; deals_won: number }[]
  loss_by_reason: { label: string; count: number; value: number | null }[]
  conversion_by_source: { source: string | null; generated: number; won: number }[]
  conversion_by_campaign: {
    campaign_id: string
    campaign_name: string
    generated: number
    won: number
    tickets_total: number
    won_value: number | null
    template_category: string | null
  }[]
  sales_goal: { month: string; value_goal: number | null; count_goal: number | null; value_actual: number; count_actual: number }
}

/** Aggregates (cards, funnel, commission, the 3 new sales-origin
 *  metrics) all come from a single RPC — see get_pipeline_dashboard()
 *  (migration 083). Previously 5 raw-row fetches aggregated in JS here,
 *  two of them (open-pipeline funnel + projected commission) with no
 *  period filter AND no row cap — silently truncatable by PostgREST's
 *  implicit 1000-row limit on a large pipeline. */
export async function loadPipelineReport(
  db: DB,
  period: PeriodRange,
  accountId: string,
  timezone: string,
): Promise<PipelineReportBundle> {
  const { data, error } = await db.rpc('get_pipeline_dashboard', {
    p_account_id: accountId,
    p_start: period.startISO,
    p_end: period.endISO,
  })
  if (error) throw error

  const result = data as RpcResult

  const cards: PipelineReportCards = {
    dealsCreated: result.cards.deals_created,
    dealsWon: result.cards.deals_won,
    dealsLost: result.cards.deals_lost,
    conversionRatePct:
      result.cards.deals_won + result.cards.deals_lost === 0
        ? null
        : (result.cards.deals_won / (result.cards.deals_won + result.cards.deals_lost)) * 100,
    valueWon: result.cards.value_won ?? 0,
    avgTicket: result.cards.avg_ticket,
    avgCloseDays: result.cards.avg_close_days,
    commissionWon: result.cards.commission_won ?? 0,
    commissionProjected: result.cards.commission_projected ?? 0,
  }

  const funnel: PipelineFunnelStage[] = result.funnel.map((f) => ({
    stageId: f.stage_id,
    name: f.name,
    color: f.color,
    position: f.position,
    count: f.count,
  }))

  const dealsPerDay: DealsPerDayPoint[] = buildDealsPerDay(result.deals_per_day, period, timezone)

  const commissionByAgent: CommissionAgentRow[] = result.commission_by_agent.map((a) => ({
    profileId: a.profile_id,
    name: a.name,
    commissionWon: a.commission_won,
    dealsWon: a.deals_won,
  }))

  const lossByReason: LossReasonPoint[] = result.loss_by_reason.map((r) => ({
    label: r.label,
    count: r.count,
    value: r.value ?? 0,
  }))

  const conversionBySource: SourceConversionRow[] = result.conversion_by_source.map((r) => ({
    source: r.source,
    generated: r.generated,
    won: r.won,
  }))

  const conversionByCampaign: CampaignConversionRow[] = result.conversion_by_campaign
    .map((r) => ({
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      generated: r.generated,
      won: r.won,
      ticketsTotal: r.tickets_total,
      wonValue: r.won_value ?? 0,
      templateCategory: r.template_category,
    }))
    .sort((a, b) => b.wonValue - a.wonValue)

  const deals = await loadDealsTableRows(db, period)

  const salesGoal: SalesGoal = {
    month: result.sales_goal.month,
    valueGoal: result.sales_goal.value_goal,
    countGoal: result.sales_goal.count_goal,
    valueActual: result.sales_goal.value_actual,
    countActual: result.sales_goal.count_actual,
  }

  return {
    cards,
    avgTimeToWinDays: result.avg_time_to_win_days,
    funnel,
    dealsPerDay,
    deals,
    commissionByAgent,
    lossByReason,
    conversionBySource,
    conversionByCampaign,
    salesGoal,
  }
}

/** Cards-only call for the headline metrics' "vs. período anterior"
 *  comparison — skips the deals-table fetch (loadDealsTableRows) and
 *  every other field this RPC returns, since the trend row only needs
 *  five numbers from `cards`. */
export async function loadPipelineCards(
  db: DB,
  range: { startISO: string; endISO: string },
  accountId: string,
): Promise<PipelineReportCards> {
  const { data, error } = await db.rpc('get_pipeline_dashboard', {
    p_account_id: accountId,
    p_start: range.startISO,
    p_end: range.endISO,
  })
  if (error) throw error
  const cards = (data as RpcResult).cards
  return {
    dealsCreated: cards.deals_created,
    dealsWon: cards.deals_won,
    dealsLost: cards.deals_lost,
    conversionRatePct:
      cards.deals_won + cards.deals_lost === 0 ? null : (cards.deals_won / (cards.deals_won + cards.deals_lost)) * 100,
    valueWon: cards.value_won ?? 0,
    avgTicket: cards.avg_ticket,
    avgCloseDays: cards.avg_close_days,
    commissionWon: cards.commission_won ?? 0,
    commissionProjected: cards.commission_projected ?? 0,
  }
}

export interface FunnelCohortDeal {
  id: string
  status: string
  stageId: string | null
}

/** Deals CREATED in the period, for the cumulative stage-reach funnel
 *  — a different cohort than the headline cards' `dealsWon` (which
 *  counts by `won_at` in the period, regardless of when the deal was
 *  created). Minimal columns only: this cohort can be large and the
 *  funnel only needs status + current stage. */
export async function loadFunnelCohortDeals(db: DB, period: PeriodRange, accountId: string): Promise<FunnelCohortDeal[]> {
  const rows = await fetchAllRows<{ id: string; status: string; stage_id: string | null }>((from, to) =>
    db
      .from('deals')
      .select('id, status, stage_id')
      .eq('account_id', accountId)
      .gte('created_at', period.startISO)
      .lt('created_at', period.endISO)
      .range(from, to),
  )
  return rows.map((r) => ({ id: r.id, status: r.status, stageId: r.stage_id }))
}

/** deal_id -> set of pipeline_stages ids the deal is ever recorded as
 *  having moved to (deal_events 'created'/'stage_changed'), account-
 *  wide and not period-bound — a deal created in one period can have
 *  reached a stage logged after the period ended, and we want its
 *  true reach either way. Fetched once per account (not per period)
 *  since event history doesn't depend on which period is selected. */
export async function loadStageReachByDeal(db: DB, accountId: string): Promise<Map<string, Set<string>>> {
  const rows = await fetchAllRows<{ deal_id: string; to_stage_id: string | null }>((from, to) =>
    db
      .from('deal_events')
      .select('deal_id, to_stage_id')
      .eq('account_id', accountId)
      .in('event_type', ['stage_changed', 'created'])
      .not('to_stage_id', 'is', null)
      .range(from, to),
  )
  const map = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.to_stage_id) continue
    const set = map.get(r.deal_id) ?? new Set<string>()
    set.add(r.to_stage_id)
    map.set(r.deal_id, set)
  }
  return map
}

interface StageRow {
  id: string
  name: string
  color: string
  position: number
  pipeline_id: string
}

/** Every pipeline_stages row for the account (across all of its
 *  pipelines), regardless of whether any deal currently sits there —
 *  the funnel needs the full, ordered stage list (including
 *  zero-count stages) that get_pipeline_dashboard's open-deals
 *  grouping alone can't provide, since it only emits a row per stage
 *  that has at least one open deal right now. */
export async function loadPipelineStages(db: DB, accountId: string): Promise<PipelineStageMeta[]> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id, name, color, position, pipeline_id, pipelines!inner(account_id)')
    .eq('pipelines.account_id', accountId)
    .order('position', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as StageRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    pipelineId: s.pipeline_id,
  }))
}

/** Distinct stage_ids currently holding a won deal, account-wide, all
 *  time (not period-scoped — a pipeline's "won" stage is a structural
 *  fact, not something that changes per period). Used only to find
 *  which stage is the funnel's terminal "Ganho" step, so the
 *  horizontal funnel can stop there and exclude whatever loss-only
 *  stages a pipeline keeps after it (e.g. "Perdido"/"Sem margem") —
 *  without hardcoding any stage name. */
export async function loadWonStageIds(db: DB, accountId: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ stage_id: string | null }>((from, to) =>
    db.from('deals').select('stage_id').eq('account_id', accountId).eq('status', 'won').range(from, to),
  )
  return new Set(rows.map((d) => d.stage_id).filter((v): v is string => !!v))
}

interface SparkDealRow {
  value: number | null
  won_at: string | null
  lost_at: string | null
}

/** Per-day won-count/won-value/lost-count series for the headline
 *  KPI cards' sparklines — resampled client-side from the same won +
 *  lost deal rows the cards' totals already come from (two lean
 *  column-only queries, each bounded by the period), not a new
 *  aggregation. */
export async function loadDailyPipelineSparkSeries(
  db: DB,
  period: PeriodRange,
  accountId: string,
  timezone: string,
): Promise<PipelineDailySparkPoint[]> {
  const { startISO, endISO } = period
  const [wonRows, lostRows] = await Promise.all([
    fetchAllRows<SparkDealRow>((from, to) =>
      db
        .from('deals')
        .select('value, won_at, lost_at')
        .eq('account_id', accountId)
        .eq('status', 'won')
        .gte('won_at', startISO)
        .lt('won_at', endISO)
        .range(from, to),
    ),
    fetchAllRows<SparkDealRow>((from, to) =>
      db
        .from('deals')
        .select('value, won_at, lost_at')
        .eq('account_id', accountId)
        .eq('status', 'lost')
        .gte('lost_at', startISO)
        .lt('lost_at', endISO)
        .range(from, to),
    ),
  ])

  const byDay = new Map<string, { wonCount: number; wonValue: number; lostCount: number }>()
  for (const row of wonRows) {
    if (!row.won_at) continue
    const key = accountDayKey(new Date(row.won_at).getTime(), timezone)
    const bucket = byDay.get(key) ?? { wonCount: 0, wonValue: 0, lostCount: 0 }
    bucket.wonCount += 1
    bucket.wonValue += row.value ?? 0
    byDay.set(key, bucket)
  }
  for (const row of lostRows) {
    if (!row.lost_at) continue
    const key = accountDayKey(new Date(row.lost_at).getTime(), timezone)
    const bucket = byDay.get(key) ?? { wonCount: 0, wonValue: 0, lostCount: 0 }
    bucket.lostCount += 1
    byDay.set(key, bucket)
  }

  const points: PipelineDailySparkPoint[] = []
  const start = new Date(startISO).getTime()
  const end = new Date(endISO).getTime()
  for (let t = start; t < end; t += 86_400_000) {
    const key = accountDayKey(t, timezone)
    const bucket = byDay.get(key) ?? { wonCount: 0, wonValue: 0, lostCount: 0 }
    points.push({ date: key, ...bucket })
  }
  return points
}

/** YYYY-MM-DD for `epochMs` as observed in `timeZone` — must match the
 *  RPC's own `(won_at at time zone v_tz)::date` bucketing exactly. */
function accountDayKey(epochMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(epochMs))) if (p.type !== "literal") map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}`
}

/** One point per calendar day in the period, keyed in the ACCOUNT's
 *  timezone (matching get_pipeline_dashboard's own bucketing) — not
 *  `period.fromDate`/`toDate`, which come from the page-level generic
 *  period resolver (period.ts) in the *viewer's browser* timezone.
 *  Stepping in fixed 24h increments from the real UTC instants
 *  (`period.startISO`/`endISO`) keeps every bucket's label aligned with
 *  what the RPC actually returned, regardless of whose browser tz
 *  produced the period's boundaries. The RPC only emits a row per day
 *  that had at least one won deal — fill the gaps so the chart doesn't
 *  misread a zero-deal day as missing data. */
function buildDealsPerDay(
  rows: { date: string; won: number }[],
  period: PeriodRange,
  timezone: string,
): DealsPerDayPoint[] {
  const byDay = new Map(rows.map((r) => [r.date, r.won]))
  const points: DealsPerDayPoint[] = []
  const start = new Date(period.startISO).getTime()
  const end = new Date(period.endISO).getTime()
  for (let t = start; t < end; t += 86_400_000) {
    const key = accountDayKey(t, timezone)
    points.push({ date: key, won: byDay.get(key) ?? 0 })
  }
  return points
}

interface DealRow {
  id: string
  title: string
  value: number | null
  currency: string | null
  status: string
  created_at: string
  won_at: string | null
  lost_at: string | null
  contact: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
  assignee:
    | { id: string; full_name: string | null; email: string | null }
    | { id: string; full_name: string | null; email: string | null }[]
    | null
  stage: { name: string; color: string } | { name: string; color: string }[] | null
}

const DEAL_TABLE_SELECT =
  'id, title, value, currency, status, created_at, won_at, lost_at, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(id, full_name, email), stage:pipeline_stages(name, color)'

/** The individual-deal listing (DealsTable) stays a plain client fetch
 *  — it's a row listing, not an aggregation, so there's nothing for the
 *  RPC to compute. Still period-unbounded in row count like before
 *  (no `.limit()`/pagination) — a known follow-up, deliberately kept
 *  out of this round per the agreed plan. */
async function loadDealsTableRows(db: DB, period: PeriodRange): Promise<DealReportRow[]> {
  const { startISO, endISO } = period

  const [createdRes, wonRes, lostRes] = await Promise.all([
    db.from('deals').select(DEAL_TABLE_SELECT).gte('created_at', startISO).lt('created_at', endISO),
    db.from('deals').select(DEAL_TABLE_SELECT).eq('status', 'won').gte('won_at', startISO).lt('won_at', endISO),
    db.from('deals').select(DEAL_TABLE_SELECT).eq('status', 'lost').gte('lost_at', startISO).lt('lost_at', endISO),
  ])
  if (createdRes.error) throw createdRes.error
  if (wonRes.error) throw wonRes.error
  if (lostRes.error) throw lostRes.error

  const created = (createdRes.data ?? []) as unknown as DealRow[]
  const won = (wonRes.data ?? []) as unknown as DealRow[]
  const lost = (lostRes.data ?? []) as unknown as DealRow[]

  // De-duplicated by id — a deal created AND won in the same period
  // would otherwise appear in both source lists.
  const byId = new Map<string, DealRow>()
  for (const d of [...created, ...won, ...lost]) byId.set(d.id, d)

  return [...byId.values()]
    .map((d) => {
      const contact = one(d.contact)
      const assignee = one(d.assignee)
      const stage = one(d.stage)
      return {
        id: d.id,
        title: d.title,
        contactName: contact?.name || contact?.phone || null,
        value: d.value ?? 0,
        currency: d.currency || 'USD',
        stageName: stage?.name ?? null,
        stageColor: stage?.color ?? null,
        assigneeName: assignee?.full_name || assignee?.email || null,
        createdAt: d.created_at,
        closedAt: d.won_at ?? d.lost_at ?? null,
        status: d.status,
      }
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}
