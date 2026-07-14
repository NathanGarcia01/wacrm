import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAndSaveBroadcastCost } from '@/lib/broadcasts/meta-cost'
import { addCostBreakdown, computeRoiCards, costBreakdown, ZERO_COST } from '@/lib/broadcasts/roi-metrics'
import type {
  AttributedWonDeal,
} from '@/lib/broadcasts/roi-metrics'
import type { BroadcastRoiBundle, BroadcastRoiRow, PeriodRange } from './types'

type DB = SupabaseClient

interface BroadcastRow {
  id: string
  account_id: string
  name: string
  template_name: string
  template_language: string
  status: string
  sent_count: number
  replied_count: number
  meta_total_cost: number
  meta_cost_marketing: number
  meta_cost_utility: number
  meta_cost_authentication: number
  created_at: string
}

interface DealRow {
  id: string
  contact_id: string
  value: number
  status: string
  won_at: string | null
  created_at: string
  products: { commission_value: number | null }[] | null
}

/**
 * Attribution rule mirrors the single-broadcast ROI card on
 * /broadcasts/[id]: a deal counts toward a broadcast's ROI when its
 * contact received that broadcast AND the deal was created after the
 * broadcast went out. A contact reached by several broadcasts before
 * converting can attribute the same deal to more than one of them —
 * there's no single source of truth for "which touch actually did
 * it", so this deliberately over-counts rather than arbitrarily
 * picking one.
 *
 * Return is measured in COMMISSION (sum of deal_products.commission_value
 * on won deals), not deal value — matches what the account actually
 * earned from the spend, not the gross deal size.
 */
export async function loadBroadcastRoiReport(db: DB, period: PeriodRange): Promise<BroadcastRoiBundle> {
  const { startISO, endISO } = period

  const { data, error } = await db
    .from('broadcasts')
    .select(
      'id, account_id, name, template_name, template_language, status, sent_count, replied_count, meta_total_cost, meta_cost_marketing, meta_cost_utility, meta_cost_authentication, created_at',
    )
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .order('created_at', { ascending: false })
  if (error) throw error

  const broadcasts = (data ?? []) as BroadcastRow[]
  if (broadcasts.length === 0) {
    return {
      cards: computeRoiCards({ cost: ZERO_COST, leadsGenerated: 0, dealsCreated: 0, wonDeals: [] }),
      rows: [],
      funnel: { sent: 0, replied: 0, dealsCreated: 0, dealsWon: 0 },
    }
  }

  const categoryByKey = new Map<string, string>()
  const { data: templates } = await db
    .from('message_templates')
    .select('name, language, category')
    .in('name', [...new Set(broadcasts.map((b) => b.template_name))])
  for (const t of (templates ?? []) as { name: string; language: string; category: string }[]) {
    categoryByKey.set(`${t.name}::${t.language}`, t.category)
  }
  const categoryFor = (b: BroadcastRow) => categoryByKey.get(`${b.template_name}::${b.template_language}`) ?? null

  // Lazy backfill: a broadcast that finished sending before this
  // feature existed (or before meta_pricing was configured) has
  // meta_total_cost stuck at 0. Recompute it now from the account's
  // CURRENT rates so historical broadcasts aren't stuck showing R$0
  // forever — computeAndSaveBroadcastCost persists the result too, so
  // this only happens once per broadcast (until rates change again).
  const needsBackfill = broadcasts.filter((b) => b.status === 'sent' && b.meta_total_cost === 0 && b.sent_count > 0)
  await Promise.all(
    needsBackfill.map((b) =>
      computeAndSaveBroadcastCost(db, {
        broadcastId: b.id,
        accountId: b.account_id,
        templateCategory: categoryFor(b),
        sentCount: b.sent_count,
      }).then((cost) => {
        b.meta_total_cost = cost
      }),
    ),
  )

  const broadcastIds = broadcasts.map((b) => b.id)
  const { data: recipients } = await db
    .from('broadcast_recipients')
    .select('broadcast_id, contact_id')
    .in('broadcast_id', broadcastIds)
    .not('contact_id', 'is', null)

  const contactsByBroadcast = new Map<string, Set<string>>()
  const allContactIds = new Set<string>()
  for (const r of (recipients ?? []) as { broadcast_id: string; contact_id: string }[]) {
    if (!contactsByBroadcast.has(r.broadcast_id)) contactsByBroadcast.set(r.broadcast_id, new Set())
    contactsByBroadcast.get(r.broadcast_id)!.add(r.contact_id)
    allContactIds.add(r.contact_id)
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
        .select('id, contact_id, value, status, won_at, created_at, products:deal_products(commission_value)')
        .in('contact_id', chunk)
      if (dealsError) throw dealsError
      deals.push(...((dealsData ?? []) as unknown as DealRow[]))
    }
  }
  const dealCommission = (d: DealRow) =>
    (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)

  const rows: BroadcastRoiRow[] = broadcasts.map((b) => {
    const contacts = contactsByBroadcast.get(b.id) ?? new Set<string>()
    const attributedDeals = deals.filter((d) => contacts.has(d.contact_id) && d.created_at > b.created_at)
    const wonDeals: AttributedWonDeal[] = attributedDeals
      .filter((d) => d.status === 'won' && d.won_at)
      .map((d) => ({ commission: dealCommission(d), wonAt: d.won_at!, broadcastCreatedAt: b.created_at }))
    const commissionGenerated = wonDeals.reduce((sum, d) => sum + d.commission, 0)
    const cost = b.meta_total_cost
    return {
      id: b.id,
      name: b.name,
      templateCategory: categoryFor(b),
      sentCount: b.sent_count,
      cost,
      dealsWon: wonDeals.length,
      commissionGenerated,
      roiPct: cost > 0 ? ((commissionGenerated - cost) / cost) * 100 : null,
    }
  })

  // Aggregate cards + funnel across every broadcast in the period.
  let totalCost = ZERO_COST
  let totalLeads = 0
  let totalDealsCreated = 0
  const allWonDeals: AttributedWonDeal[] = []
  for (const b of broadcasts) {
    const contacts = contactsByBroadcast.get(b.id) ?? new Set<string>()
    const attributedDeals = deals.filter((d) => contacts.has(d.contact_id) && d.created_at > b.created_at)
    totalDealsCreated += attributedDeals.length
    for (const d of attributedDeals) {
      if (d.status === 'won' && d.won_at) {
        allWonDeals.push({ commission: dealCommission(d), wonAt: d.won_at, broadcastCreatedAt: b.created_at })
      }
    }
    totalLeads += b.replied_count
    // meta_cost_marketing/utility/authentication are always written
    // together with meta_total_cost by computeAndSaveBroadcastCost, so
    // they're already in sync — no fallback needed here.
    totalCost = addCostBreakdown(
      totalCost,
      costBreakdown({
        category: categoryFor(b),
        sentCount: b.sent_count,
        rateMarketing: b.meta_cost_marketing,
        rateUtility: b.meta_cost_utility,
        rateAuthentication: b.meta_cost_authentication,
      }),
    )
  }

  const cards = computeRoiCards({
    cost: totalCost,
    leadsGenerated: totalLeads,
    dealsCreated: totalDealsCreated,
    wonDeals: allWonDeals,
  })

  const totalSent = broadcasts.reduce((sum, b) => sum + b.sent_count, 0)
  const funnel = {
    sent: totalSent,
    replied: totalLeads,
    dealsCreated: totalDealsCreated,
    dealsWon: allWonDeals.length,
  }

  return { cards, rows: rows.sort((a, b) => b.commissionGenerated - a.commissionGenerated), funnel }
}
