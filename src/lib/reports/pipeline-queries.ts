import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from '@/lib/dashboard/date-utils'
import type {
  CommissionAgentRow,
  DealReportRow,
  DealsPerDayPoint,
  PeriodRange,
  PipelineFunnelStage,
  PipelineReportBundle,
  PipelineReportCards,
} from './types'

type DB = SupabaseClient

interface DealProductCommissionRow {
  commission_value: number | null
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
  stage_id: string | null
  contact: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
  assignee:
    | { id: string; full_name: string | null; email: string | null }
    | { id: string; full_name: string | null; email: string | null }[]
    | null
  stage: { name: string; color: string } | { name: string; color: string }[] | null
  products?: DealProductCommissionRow[]
}

function dealCommission(d: DealRow): number {
  return (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function loadPipelineReport(db: DB, period: PeriodRange): Promise<PipelineReportBundle> {
  const { startISO, endISO } = period

  // Deals "of the period" for the cards/table: created OR won OR lost
  // within the range — a deal opened last month but won this week
  // still needs to count toward this week's "won" metrics, so we
  // can't filter purely on created_at.
  const [createdRes, wonRes, lostRes, openStagesRes, openCommissionRes] = await Promise.all([
    db
      .from('deals')
      .select(
        'id, title, value, currency, status, created_at, won_at, lost_at, stage_id, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(id, full_name, email), stage:pipeline_stages(name, color)',
      )
      .gte('created_at', startISO)
      .lt('created_at', endISO),
    db
      .from('deals')
      .select(
        'id, title, value, currency, status, created_at, won_at, lost_at, stage_id, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(id, full_name, email), stage:pipeline_stages(name, color), products:deal_products(commission_value)',
      )
      .eq('status', 'won')
      .gte('won_at', startISO)
      .lt('won_at', endISO),
    db
      .from('deals')
      .select(
        'id, title, value, currency, status, created_at, won_at, lost_at, stage_id, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(id, full_name, email), stage:pipeline_stages(name, color)',
      )
      .eq('status', 'lost')
      .gte('lost_at', startISO)
      .lt('lost_at', endISO),
    // Funnel — current open pipeline, not period-scoped. It answers
    // "what does the pipeline look like right now", same as the
    // Pipelines page's board, not "what moved through it this period".
    db
      .from('deals')
      .select('stage_id, pipeline_stages!inner(name, color, position)')
      .eq('status', 'open'),
    // Projected commission — same "current pipeline" scope as the
    // funnel above, not period-filtered.
    db
      .from('deals')
      .select('id, products:deal_products(commission_value)')
      .eq('status', 'open'),
  ])
  if (createdRes.error) throw createdRes.error
  if (wonRes.error) throw wonRes.error
  if (lostRes.error) throw lostRes.error
  if (openStagesRes.error) throw openStagesRes.error
  if (openCommissionRes.error) throw openCommissionRes.error

  const created = (createdRes.data ?? []) as unknown as DealRow[]
  const won = (wonRes.data ?? []) as unknown as DealRow[]
  const lost = (lostRes.data ?? []) as unknown as DealRow[]
  const openForCommission = (openCommissionRes.data ?? []) as unknown as DealRow[]

  const valueWon = won.reduce((sum, d) => sum + (d.value ?? 0), 0)
  const commissionWon = won.reduce((sum, d) => sum + dealCommission(d), 0)
  const commissionProjected = openForCommission.reduce((sum, d) => sum + dealCommission(d), 0)
  const conversionDenominator = won.length + lost.length
  const closeDaysList = won
    .filter((d) => d.won_at)
    .map((d) => (new Date(d.won_at!).getTime() - new Date(d.created_at).getTime()) / 86_400_000)

  const cards: PipelineReportCards = {
    dealsCreated: created.length,
    dealsWon: won.length,
    dealsLost: lost.length,
    conversionRatePct: conversionDenominator === 0 ? null : (won.length / conversionDenominator) * 100,
    valueWon,
    avgTicket: won.length === 0 ? null : valueWon / won.length,
    avgCloseDays:
      closeDaysList.length === 0
        ? null
        : closeDaysList.reduce((a, b) => a + b, 0) / closeDaysList.length,
    commissionWon,
    commissionProjected,
  }

  // Commission by agent — won deals only, ranked by commission descending.
  // Deals with no assignee are excluded (nothing to rank).
  const agentMap = new Map<string, CommissionAgentRow>()
  for (const d of won) {
    const assignee = one(d.assignee)
    if (!assignee) continue
    const commission = dealCommission(d)
    const existing = agentMap.get(assignee.id)
    if (existing) {
      existing.commissionWon += commission
      existing.dealsWon += 1
    } else {
      agentMap.set(assignee.id, {
        profileId: assignee.id,
        name: assignee.full_name || assignee.email || 'Unknown',
        commissionWon: commission,
        dealsWon: 1,
      })
    }
  }
  const commissionByAgent = [...agentMap.values()].sort((a, b) => b.commissionWon - a.commissionWon)

  // Funnel: one row per open deal, grouped by stage. Stages with zero
  // open deals still need to render (an empty bar tells its own
  // story), so start from the distinct stage set seen in the rows
  // rather than only stages that have at least one deal.
  const funnelMap = new Map<string, PipelineFunnelStage>()
  for (const row of (openStagesRes.data ?? []) as unknown as {
    stage_id: string
    pipeline_stages: { name: string; color: string; position: number } | { name: string; color: string; position: number }[]
  }[]) {
    const stage = one(row.pipeline_stages)
    if (!stage) continue
    const existing = funnelMap.get(row.stage_id)
    if (existing) {
      existing.count++
    } else {
      funnelMap.set(row.stage_id, {
        stageId: row.stage_id,
        name: stage.name,
        color: stage.color,
        position: stage.position,
        count: 1,
      })
    }
  }
  const funnel = [...funnelMap.values()].sort((a, b) => a.position - b.position)

  // Deals-won-per-day series, one point per calendar day in range.
  const wonByDay = new Map<string, number>()
  for (const d of won) {
    if (!d.won_at) continue
    const key = localDayKey(d.won_at)
    wonByDay.set(key, (wonByDay.get(key) ?? 0) + 1)
  }
  const dealsPerDay: DealsPerDayPoint[] = []
  const cursor = new Date(startISO)
  const end = new Date(endISO)
  while (cursor < end) {
    const key = localDayKey(cursor)
    dealsPerDay.push({ date: key, won: wonByDay.get(key) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  // Table: every deal touched (created/won/lost) in the period,
  // de-duplicated by id since a deal created AND won in the same
  // period would otherwise appear in both source lists.
  const byId = new Map<string, DealRow>()
  for (const d of [...created, ...won, ...lost]) byId.set(d.id, d)
  const deals: DealReportRow[] = [...byId.values()]
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

  return { cards, funnel, dealsPerDay, deals, commissionByAgent }
}
