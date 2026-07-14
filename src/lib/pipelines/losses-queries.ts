import type { SupabaseClient } from '@supabase/supabase-js'
import type { PeriodRange } from '@/lib/reports/types'

type DB = SupabaseClient

export interface LossReasonBreakdown {
  reason: string
  count: number
  value: number
  /** 0-100, this reason's share of total lost deals in the period. */
  pct: number
}

export interface LossDealRow {
  id: string
  title: string
  contactName: string | null
  value: number
  currency?: string
  lostReason: string | null
  assigneeName: string | null
  lostAt: string
  stageName: string | null
  /** Messages exchanged in the deal's conversation up to the loss. Null
   *  when the deal has no linked conversation. */
  messagesBeforeLoss: number | null
  /** lost_at - created_at, in days. */
  daysToLoss: number
}

export interface LossesReportData {
  /** Deals created in the period, any status — the funnel's top of mouth. */
  leadsEntered: number
  totalLost: number
  totalWon: number
  /** totalLost / leadsEntered × 100. Null when leadsEntered is 0. */
  lossRatePct: number | null
  byReason: LossReasonBreakdown[]
  deals: LossDealRow[]
}

interface DealRow {
  id: string
  title: string
  value: number
  currency: string | null
  status: string | null
  lost_reason: string | null
  lost_at: string | null
  won_at: string | null
  created_at: string
  stage_id: string
  conversation_id: string | null
  contact: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
  assignee: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * Losses report for the Pipeline > Perdas view. Uses two DIFFERENT
 * date dimensions deliberately, matching standard funnel-reporting
 * convention: "leads entered" counts by created_at (when the deal
 * showed up), while "lost"/"won" count by their own close date
 * (lost_at / won_at) — a deal created last month but lost this month
 * counts as a loss this month even though it didn't "enter" this
 * month. This is a different period semantic than the Board/CSV
 * export's "effective date" filter (pipeline-filter-bar.tsx), which
 * is deliberate here: this view is asking "what happened in this
 * period", not "what deals are currently in scope".
 */
export async function loadLossesReport(
  db: DB,
  args: {
    pipelineId: string
    period: PeriodRange | null
    assignedTo: string // "" = all, "unassigned" = no assignee, else profile id
    stageNameById: Map<string, string>
  },
): Promise<LossesReportData> {
  const { pipelineId, period, assignedTo, stageNameById } = args

  const selectCols =
    'id, title, value, currency, status, lost_reason, lost_at, won_at, created_at, stage_id, conversation_id, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(full_name, email)'

  let leadsQuery = db.from('deals').select('id', { count: 'exact', head: true }).eq('pipeline_id', pipelineId)
  if (period) leadsQuery = leadsQuery.gte('created_at', period.startISO).lt('created_at', period.endISO)
  if (assignedTo === 'unassigned') leadsQuery = leadsQuery.is('assigned_to', null)
  else if (assignedTo !== '') leadsQuery = leadsQuery.eq('assigned_to', assignedTo)

  let lostQuery = db.from('deals').select(selectCols).eq('pipeline_id', pipelineId).eq('status', 'lost')
  if (period) lostQuery = lostQuery.gte('lost_at', period.startISO).lt('lost_at', period.endISO)
  if (assignedTo === 'unassigned') lostQuery = lostQuery.is('assigned_to', null)
  else if (assignedTo !== '') lostQuery = lostQuery.eq('assigned_to', assignedTo)

  let wonQuery = db
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('pipeline_id', pipelineId)
    .eq('status', 'won')
  if (period) wonQuery = wonQuery.gte('won_at', period.startISO).lt('won_at', period.endISO)
  if (assignedTo === 'unassigned') wonQuery = wonQuery.is('assigned_to', null)
  else if (assignedTo !== '') wonQuery = wonQuery.eq('assigned_to', assignedTo)

  const [leadsRes, lostRes, wonRes] = await Promise.all([leadsQuery, lostQuery, wonQuery])

  const lostRows = (lostRes.data ?? []) as unknown as DealRow[]
  const leadsEntered = leadsRes.count ?? 0
  const totalWon = wonRes.count ?? 0

  // Message counts "before the loss" — fetched in bulk for every lost
  // deal's conversation, then filtered per-deal by lost_at client-side
  // (Postgres can't express a per-row cutoff in a single grouped count).
  const conversationIds = [...new Set(lostRows.map((d) => d.conversation_id).filter((id): id is string => !!id))]
  const messagesByConversation = new Map<string, string[]>() // conversation_id -> created_at[]
  if (conversationIds.length > 0) {
    const { data: msgs } = await db
      .from('messages')
      .select('conversation_id, created_at')
      .in('conversation_id', conversationIds)
    for (const m of (msgs ?? []) as { conversation_id: string; created_at: string }[]) {
      if (!messagesByConversation.has(m.conversation_id)) messagesByConversation.set(m.conversation_id, [])
      messagesByConversation.get(m.conversation_id)!.push(m.created_at)
    }
  }

  const deals: LossDealRow[] = lostRows.map((d) => {
    const contact = one(d.contact)
    const assignee = one(d.assignee)
    const lostAt = d.lost_at ?? d.created_at
    const daysToLoss = Math.max(
      0,
      (new Date(lostAt).getTime() - new Date(d.created_at).getTime()) / 86_400_000,
    )
    const conversationMessages = d.conversation_id ? messagesByConversation.get(d.conversation_id) : undefined
    const messagesBeforeLoss = conversationMessages
      ? conversationMessages.filter((ts) => ts <= lostAt).length
      : null
    return {
      id: d.id,
      title: d.title,
      contactName: contact?.name || contact?.phone || null,
      value: d.value ?? 0,
      currency: d.currency ?? undefined,
      lostReason: d.lost_reason?.trim() || null,
      assigneeName: assignee?.full_name || assignee?.email || null,
      lostAt,
      stageName: stageNameById.get(d.stage_id) ?? null,
      messagesBeforeLoss,
      daysToLoss,
    }
  })

  const reasonMap = new Map<string, { count: number; value: number }>()
  for (const d of deals) {
    const key = d.lostReason ?? '__none__'
    const row = reasonMap.get(key) ?? { count: 0, value: 0 }
    row.count += 1
    row.value += d.value
    reasonMap.set(key, row)
  }
  const totalLost = deals.length
  const byReason: LossReasonBreakdown[] = [...reasonMap.entries()]
    .map(([reason, { count, value }]) => ({
      reason: reason === '__none__' ? '' : reason,
      count,
      value,
      pct: totalLost > 0 ? (count / totalLost) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    leadsEntered,
    totalLost,
    totalWon,
    lossRatePct: leadsEntered > 0 ? (totalLost / leadsEntered) * 100 : null,
    byReason,
    deals: deals.sort((a, b) => b.lostAt.localeCompare(a.lostAt)),
  }
}
