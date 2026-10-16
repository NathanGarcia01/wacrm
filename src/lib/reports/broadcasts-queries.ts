import type { SupabaseClient } from '@supabase/supabase-js'
import { findLastTouch, loadTouchesByPhone, touchWindowFor } from '@/lib/broadcasts/attribution'
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
  phone_normalized: string | null
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
 * button clicks) plus deals/commission attributed via the shared
 * last-touch/30-day/phone rule (src/lib/broadcasts/attribution.ts —
 * same rule Pipeline & Vendas uses for campaign attribution).
 *
 * "Period" governs which broadcasts are listed as rows and which won
 * deals count toward the cards (won_at in period) — NOT which
 * broadcast gets credit for them. A deal that closed inside the
 * period can still be attributed to a broadcast sent before the
 * period started, as long as it's within the 30-day window before
 * the deal was CREATED (the FIEB case: broadcast sent 19/08, deal
 * created the same day, won 01/09 — a report scoped to 28/08+ must
 * still count that win, just without a matching row to show it on).
 * dealsWon/commissionGenerated on the cards are the deduped, honest
 * totals; periodTotalDealsWon/periodTotalCommission are the SAME
 * period's full totals (attributed or not) so the UI can show "this
 * is only N% of what actually closed" instead of implying the two
 * numbers are the same thing.
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

  // Won deals for the period are the primary driver for the honest
  // totals — loaded regardless of whether any broadcast exists in the
  // period, since a deal can be attributed to a touch from before it.
  const { data: wonDealsData, error: wonDealsError } = await db
    .from('deals')
    .select(
      'id, contact_id, status, won_at, created_at, contact:contacts(phone_normalized), products:deal_products(commission_value)',
    )
    .eq('status', 'won')
    .gte('won_at', startISO)
    .lt('won_at', endISO)
  if (wonDealsError) throw wonDealsError
  const wonDeals: DealRow[] = ((wonDealsData ?? []) as unknown as (DealRow & {
    contact: { phone_normalized: string | null } | { phone_normalized: string | null }[] | null
  })[]).map((d) => ({
    ...d,
    phone_normalized: Array.isArray(d.contact) ? d.contact[0]?.phone_normalized ?? null : d.contact?.phone_normalized ?? null,
  }))

  const periodTotalDealsWon = wonDeals.length
  const periodTotalCommission = wonDeals.reduce((sum, d) => sum + dealCommission(d), 0)

  if (broadcasts.length === 0 && wonDeals.length === 0) {
    return {
      cards: {
        totalBroadcasts: 0,
        totalSent: 0,
        uniqueContactsReached: 0,
        replyRatePct: null,
        dealsWon: 0,
        commissionGenerated: 0,
        periodTotalDealsWon: 0,
        periodTotalCommission: 0,
      },
      broadcasts: [],
      funnel: { sent: 0, replied: 0, dealsCreated: 0, dealsWon: 0 },
    }
  }

  const broadcastIds = broadcasts.map((b) => b.id)
  const periodBroadcastIds = new Set(broadcastIds)
  let recipients: RecipientRow[] = []
  if (broadcastIds.length > 0) {
    const { data: recipientsData, error: recipientsError } = await db
      .from('broadcast_recipients')
      .select('broadcast_id, contact_id, status, button_clicked')
      .in('broadcast_id', broadcastIds)
    if (recipientsError) throw recipientsError
    recipients = (recipientsData ?? []) as RecipientRow[]
  }

  const recipientsByBroadcast = new Map<string, RecipientRow[]>()
  const receivedContactIds = new Set<string>()
  for (const r of recipients) {
    if (!recipientsByBroadcast.has(r.broadcast_id)) recipientsByBroadcast.set(r.broadcast_id, [])
    recipientsByBroadcast.get(r.broadcast_id)!.push(r)
    if (r.contact_id && RECEIVED_STATUSES.has(r.status)) receivedContactIds.add(r.contact_id)
  }

  // Deals created in the period feed the "created" funnel step — same
  // attribution rule, keyed off the deal's own created_at.
  const { data: createdDealsData, error: createdDealsError } = await db
    .from('deals')
    .select('id, contact_id, status, won_at, created_at, contact:contacts(phone_normalized)')
    .gte('created_at', startISO)
    .lt('created_at', endISO)
  if (createdDealsError) throw createdDealsError
  const createdDeals = (
    (createdDealsData ?? []) as unknown as {
      id: string
      contact_id: string
      status: string
      won_at: string | null
      created_at: string
      contact: { phone_normalized: string | null } | { phone_normalized: string | null }[] | null
    }[]
  ).map((d) => ({
    ...d,
    phone_normalized: Array.isArray(d.contact) ? d.contact[0]?.phone_normalized ?? null : d.contact?.phone_normalized ?? null,
  }))

  const allCreatedAts = [...wonDeals.map((d) => d.created_at), ...createdDeals.map((d) => d.created_at)]
  const window = touchWindowFor(allCreatedAts)
  const touchesByPhone = window ? await loadTouchesByPhone(db, window) : new Map()

  const wonByBroadcast = new Map<string, { count: number; commission: number }>()
  let dealsWon = 0
  let commissionGenerated = 0
  for (const d of wonDeals) {
    const touch = d.phone_normalized ? findLastTouch(touchesByPhone.get(d.phone_normalized), d.created_at) : null
    if (!touch) continue
    dealsWon++
    const commission = dealCommission(d)
    commissionGenerated += commission
    if (periodBroadcastIds.has(touch.broadcastId)) {
      const bucket = wonByBroadcast.get(touch.broadcastId) ?? { count: 0, commission: 0 }
      bucket.count++
      bucket.commission += commission
      wonByBroadcast.set(touch.broadcastId, bucket)
    }
  }

  let dealsCreated = 0
  for (const d of createdDeals) {
    const touch = d.phone_normalized ? findLastTouch(touchesByPhone.get(d.phone_normalized), d.created_at) : null
    if (touch) dealsCreated++
  }

  const broadcastRows: BroadcastReportRow[] = broadcasts.map((b) => {
    const recips = recipientsByBroadcast.get(b.id) ?? []
    const buttonStats = topButtonStats(recips, b.sent_count)
    const buttonClickers = recips.filter((r) => r.button_clicked).length
    const freeTextCount = Math.max(0, b.replied_count - buttonClickers)
    const won = wonByBroadcast.get(b.id) ?? { count: 0, commission: 0 }

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
      dealsWon: won.count,
      commissionGenerated: won.commission,
    }
  })

  const totalSent = broadcasts.reduce((sum, b) => sum + b.sent_count, 0)
  const totalReplied = broadcasts.reduce((sum, b) => sum + b.replied_count, 0)

  const cards: BroadcastReportCards = {
    totalBroadcasts: broadcasts.length,
    totalSent,
    uniqueContactsReached: receivedContactIds.size,
    replyRatePct: totalSent === 0 ? null : (totalReplied / totalSent) * 100,
    dealsWon,
    commissionGenerated,
    periodTotalDealsWon,
    periodTotalCommission,
  }

  const funnel: BroadcastReportFunnel = {
    sent: totalSent,
    replied: totalReplied,
    dealsCreated,
    dealsWon,
  }

  return { cards, broadcasts: broadcastRows, funnel }
}
