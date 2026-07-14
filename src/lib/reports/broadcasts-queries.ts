import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BroadcastButtonStat,
  BroadcastReportCards,
  BroadcastReportFunnel,
  BroadcastReportRow,
  BroadcastsReportBundle,
  PeriodRange,
} from './types'

type DB = SupabaseClient

interface BroadcastRow {
  id: string
  name: string
  template_name: string
  created_at: string
  sent_count: number
  replied_count: number
}

interface RecipientRow {
  broadcast_id: string
  contact_id: string | null
  status: string
  button_clicked: string | null
}

/** Recipient actually got the message — excludes 'pending' (not sent
 *  yet) and 'failed' (WhatsApp rejected it). */
const RECEIVED_STATUSES = new Set(['sent', 'delivered', 'read', 'replied'])

interface DealRow {
  id: string
  contact_id: string
  status: string
  won_at: string | null
  created_at: string
  products: { commission_value: number | null }[] | null
}

function dealCommission(d: DealRow): number {
  return (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)
}

/** Top-2 clicked button labels for one broadcast's recipients, ranked by count. */
function topButtonStats(recipients: RecipientRow[], sentCount: number): BroadcastButtonStat[] {
  const counts = new Map<string, number>()
  for (const r of recipients) {
    if (!r.button_clicked) continue
    counts.set(r.button_clicked, (counts.get(r.button_clicked) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: sentCount > 0 ? (count / sentCount) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
}

/**
 * Loads the full-period broadcasts report: engagement (sent/replied/
 * button clicks) plus deals/commission attributed the same way as the
 * ROI tab (src/lib/reports/broadcast-roi-queries.ts) — a deal counts
 * toward a broadcast when its contact received that broadcast AND the
 * deal was created after the broadcast went out. Kept as a separate,
 * self-contained query (rather than sharing the ROI file's attribution
 * loop) since this report doesn't need cost/ROI at all and the two
 * tabs should stay independently editable.
 */
export async function loadBroadcastsReport(db: DB, period: PeriodRange): Promise<BroadcastsReportBundle> {
  const { startISO, endISO } = period

  const { data, error } = await db
    .from('broadcasts')
    .select('id, name, template_name, created_at, sent_count, replied_count')
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .order('created_at', { ascending: false })
  if (error) throw error

  const broadcasts = (data ?? []) as BroadcastRow[]

  if (broadcasts.length === 0) {
    return {
      cards: {
        totalBroadcasts: 0,
        totalSent: 0,
        uniqueContactsReached: 0,
        replyRatePct: null,
        dealsWon: 0,
        commissionGenerated: 0,
      },
      broadcasts: [],
      funnel: { sent: 0, replied: 0, dealsCreated: 0, dealsWon: 0 },
    }
  }

  const broadcastIds = broadcasts.map((b) => b.id)
  const { data: recipientsData, error: recipientsError } = await db
    .from('broadcast_recipients')
    .select('broadcast_id, contact_id, status, button_clicked')
    .in('broadcast_id', broadcastIds)
  if (recipientsError) throw recipientsError
  const recipients = (recipientsData ?? []) as RecipientRow[]

  // Two contact sets, deliberately different scopes:
  //  - contactsByBroadcast/allContactIds: every recipient regardless of
  //    status, used for deal attribution — matches the ROI tab's
  //    convention (broadcast-roi-queries.ts) so "which deals count
  //    toward this broadcast" doesn't drift between the two reports.
  //  - receivedContactIds: only recipients who actually got the
  //    message, for the "leads subidos" card — a pending/failed send
  //    never reached anyone.
  const recipientsByBroadcast = new Map<string, RecipientRow[]>()
  const contactsByBroadcast = new Map<string, Set<string>>()
  const allContactIds = new Set<string>()
  const receivedContactIds = new Set<string>()
  for (const r of recipients) {
    if (!recipientsByBroadcast.has(r.broadcast_id)) recipientsByBroadcast.set(r.broadcast_id, [])
    recipientsByBroadcast.get(r.broadcast_id)!.push(r)
    if (r.contact_id) {
      if (!contactsByBroadcast.has(r.broadcast_id)) contactsByBroadcast.set(r.broadcast_id, new Set())
      contactsByBroadcast.get(r.broadcast_id)!.add(r.contact_id)
      allContactIds.add(r.contact_id)
      if (RECEIVED_STATUSES.has(r.status)) receivedContactIds.add(r.contact_id)
    }
  }

  // Chunked — an account with many contacts reached in the period can
  // easily push a single `.in('contact_id', …)` past PostgREST's URL
  // length limit (each UUID is ~37 bytes URL-encoded; a few hundred
  // already blows past it and the request comes back 400 Bad Request).
  const CONTACT_CHUNK = 200
  const deals: DealRow[] = []
  if (allContactIds.size > 0) {
    const contactIdList = [...allContactIds]
    for (let i = 0; i < contactIdList.length; i += CONTACT_CHUNK) {
      const chunk = contactIdList.slice(i, i + CONTACT_CHUNK)
      const { data: dealsData, error: dealsError } = await db
        .from('deals')
        .select('id, contact_id, status, won_at, created_at, products:deal_products(commission_value)')
        .in('contact_id', chunk)
      if (dealsError) throw dealsError
      deals.push(...((dealsData ?? []) as unknown as DealRow[]))
    }
  }

  const broadcastRows: BroadcastReportRow[] = broadcasts.map((b) => {
    const recips = recipientsByBroadcast.get(b.id) ?? []
    const buttonStats = topButtonStats(recips, b.sent_count)
    const buttonClickers = recips.filter((r) => r.button_clicked).length
    const freeTextCount = Math.max(0, b.replied_count - buttonClickers)

    const contacts = contactsByBroadcast.get(b.id) ?? new Set<string>()
    const attributedDeals = deals.filter((d) => contacts.has(d.contact_id) && d.created_at > b.created_at)
    const wonDeals = attributedDeals.filter((d) => d.status === 'won' && d.won_at)
    const commissionGenerated = wonDeals.reduce((sum, d) => sum + dealCommission(d), 0)

    return {
      id: b.id,
      name: b.name,
      templateName: b.template_name,
      createdAt: b.created_at,
      sentCount: b.sent_count,
      repliedCount: b.replied_count,
      replyRatePct: b.sent_count === 0 ? null : (b.replied_count / b.sent_count) * 100,
      button1: buttonStats[0] ?? null,
      button2: buttonStats[1] ?? null,
      freeTextCount,
      freeTextPct: b.sent_count === 0 ? null : (freeTextCount / b.sent_count) * 100,
      dealsWon: wonDeals.length,
      commissionGenerated,
    }
  })

  const totalSent = broadcasts.reduce((sum, b) => sum + b.sent_count, 0)
  const totalReplied = broadcasts.reduce((sum, b) => sum + b.replied_count, 0)
  const totalDealsWon = broadcastRows.reduce((sum, r) => sum + r.dealsWon, 0)
  const totalCommission = broadcastRows.reduce((sum, r) => sum + r.commissionGenerated, 0)
  const totalDealsCreated = broadcasts.reduce((sum, b) => {
    const contacts = contactsByBroadcast.get(b.id) ?? new Set<string>()
    return sum + deals.filter((d) => contacts.has(d.contact_id) && d.created_at > b.created_at).length
  }, 0)

  const cards: BroadcastReportCards = {
    totalBroadcasts: broadcasts.length,
    totalSent,
    uniqueContactsReached: receivedContactIds.size,
    replyRatePct: totalSent === 0 ? null : (totalReplied / totalSent) * 100,
    dealsWon: totalDealsWon,
    commissionGenerated: totalCommission,
  }

  const funnel: BroadcastReportFunnel = {
    sent: totalSent,
    replied: totalReplied,
    dealsCreated: totalDealsCreated,
    dealsWon: totalDealsWon,
  }

  return { cards, broadcasts: broadcastRows, funnel }
}
