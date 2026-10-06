import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CampaignConversionRow,
  CommissionAgentRow,
  DealReportRow,
  DealsPerDayPoint,
  LossReasonPoint,
  PeriodRange,
  PipelineFunnelStage,
  PipelineReportBundle,
  PipelineReportCards,
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
  conversion_by_campaign: { campaign_id: string; campaign_name: string; generated: number; won: number }[]
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
    }))
    .sort((a, b) => b.generated - a.generated)

  const deals = await loadDealsTableRows(db, period)

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
  }
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
