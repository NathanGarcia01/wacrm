import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommissionAgentRow,
  CommissionByMonthPoint,
  CommissionReportBundle,
  CommissionReportCards,
  CommissionRow,
  CommissionStatusFilter,
  PeriodRange,
} from './types'

type DB = SupabaseClient

interface DealProductRow {
  name: string
  value: number | null
  quantity: number | null
  commission_rate: number | null
  commission_value: number | null
}

interface DealRow {
  id: string
  title: string
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
  products: DealProductRow[] | null
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function monthKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function dealCommission(d: DealRow): number {
  return (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)
}

const DEAL_SELECT =
  'id, title, currency, status, created_at, won_at, lost_at, stage_id, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(id, full_name, email), products:deal_products(name, value, quantity, commission_rate, commission_value)'

/**
 * Query base for the Commissions report tab (`/reports?tab=commissions`).
 * Mirrors deal_products → deals → profiles, per the spec's given SQL,
 * but split by status since each status scopes the period to a
 * different date column (won_at / lost_at / created_at for open).
 */
export async function loadCommissionReport(
  db: DB,
  period: PeriodRange,
  statusFilter: CommissionStatusFilter,
  stageId: string | null,
): Promise<CommissionReportBundle> {
  const { startISO, endISO } = period

  const [wonRes, lostRes, openRes, stagesRes] = await Promise.all([
    db
      .from('deals')
      .select(DEAL_SELECT)
      .eq('status', 'won')
      .gte('won_at', startISO)
      .lt('won_at', endISO),
    db
      .from('deals')
      .select(DEAL_SELECT)
      .eq('status', 'lost')
      .gte('lost_at', startISO)
      .lt('lost_at', endISO),
    // Open commission is a live-pipeline snapshot, not period-scoped —
    // same convention as the Pipeline tab's "Comissão prevista".
    db.from('deals').select(DEAL_SELECT).eq('status', 'open'),
    db.from('pipeline_stages').select('id, name').order('position'),
  ])
  if (wonRes.error) throw wonRes.error
  if (lostRes.error) throw lostRes.error
  if (openRes.error) throw openRes.error
  if (stagesRes.error) throw stagesRes.error

  const byStage = (list: DealRow[]) => (stageId ? list.filter((d) => d.stage_id === stageId) : list)
  const won = byStage((wonRes.data ?? []) as unknown as DealRow[])
  const lost = byStage((lostRes.data ?? []) as unknown as DealRow[])
  const open = byStage((openRes.data ?? []) as unknown as DealRow[])
  const stages = (stagesRes.data ?? []) as { id: string; name: string }[]

  const cards: CommissionReportCards = {
    commissionWon: won.reduce((s, d) => s + dealCommission(d), 0),
    commissionOpen: open.reduce((s, d) => s + dealCommission(d), 0),
    commissionLost: lost.reduce((s, d) => s + dealCommission(d), 0),
  }

  // The status filter only narrows the table/chart/ranking below — the
  // cards above always show the full won/open/lost breakdown.
  const included: { deal: DealRow; status: 'won' | 'lost' | 'open' }[] = []
  if (statusFilter === 'all' || statusFilter === 'won') {
    included.push(...won.map((deal) => ({ deal, status: 'won' as const })))
  }
  if (statusFilter === 'all' || statusFilter === 'lost') {
    included.push(...lost.map((deal) => ({ deal, status: 'lost' as const })))
  }
  if (statusFilter === 'all' || statusFilter === 'open') {
    included.push(...open.map((deal) => ({ deal, status: 'open' as const })))
  }

  const rows: CommissionRow[] = []
  for (const { deal, status } of included) {
    const contact = one(deal.contact)
    const assignee = one(deal.assignee)
    const date = deal.won_at ?? deal.lost_at ?? deal.created_at
    for (const p of deal.products ?? []) {
      rows.push({
        dealId: deal.id,
        dealTitle: deal.title,
        contactName: contact?.name || contact?.phone || null,
        productName: p.name,
        value: p.value ?? 0,
        quantity: p.quantity ?? 1,
        commissionRate: p.commission_rate,
        commissionValue: p.commission_value ?? 0,
        agentName: assignee?.full_name || assignee?.email || null,
        status,
        date,
        currency: deal.currency || 'USD',
      })
    }
  }
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Commission by month — won deals only, keyed by won_at (what was
  // actually earned, not projected/lost).
  const monthMap = new Map<string, number>()
  for (const d of won) {
    if (!d.won_at) continue
    const key = monthKey(d.won_at)
    monthMap.set(key, (monthMap.get(key) ?? 0) + dealCommission(d))
  }
  const byMonth: CommissionByMonthPoint[] = [...monthMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, commission]) => ({ month, commission }))

  // Agent ranking over whatever the status filter currently includes.
  const agentMap = new Map<string, CommissionAgentRow>()
  for (const { deal } of included) {
    const assignee = one(deal.assignee)
    if (!assignee) continue
    const commission = dealCommission(deal)
    if (commission === 0) continue
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
  const agentRanking = [...agentMap.values()].sort((a, b) => b.commissionWon - a.commissionWon)

  return { cards, rows, byMonth, agentRanking, stages }
}
