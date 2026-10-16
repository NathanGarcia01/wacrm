import type { SupabaseClient } from '@supabase/supabase-js'
import { findLastTouch, loadTouchesByPhone, touchWindowFor } from '@/lib/broadcasts/attribution'
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
  phone_normalized: string | null
  value: number
  status: string
  won_at: string | null
  created_at: string
  products: { commission_value: number | null }[] | null
}

function dealCommission(d: DealRow): number {
  return (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)
}

type ContactPhoneEmbed =
  | { phone_normalized: string | null }
  | { phone_normalized: string | null }[]
  | null

function phoneFromEmbed(contact: ContactPhoneEmbed): string | null {
  const c = Array.isArray(contact) ? contact[0] ?? null : contact
  return c?.phone_normalized ?? null
}

/**
 * Attribution follows the shared last-touch/30-day/phone rule
 * (src/lib/broadcasts/attribution.ts — same one Pipeline & Vendas
 * uses for campaign attribution), not the cost/ROI math: cost is
 * still exactly what was spent sending broadcasts IN the selected
 * period, independent of which deals get credited to them.
 *
 * "Period" governs which broadcasts are listed as rows/cost and which
 * won deals count toward the cards (won_at in period) — not which
 * broadcast gets credit for a given win. A deal that closed inside
 * the period can be attributed to a broadcast sent before the period
 * started, as long as it's within 30 days of when the deal was
 * CREATED (see broadcasts-queries.ts' doc comment for the concrete
 * FIEB case this fixes). periodTotalDealsWon/periodTotalCommission on
 * the cards are the period's full, unattributed totals — the honest
 * denominator for "this ROI number only covers a slice of what
 * actually closed."
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

  // Won deals for the period — the primary driver for the honest
  // totals, loaded regardless of whether any broadcast exists in the
  // period (a deal can be attributed to a touch from before it).
  const { data: wonDealsData, error: wonDealsError } = await db
    .from('deals')
    .select(
      'id, contact_id, value, status, won_at, created_at, contact:contacts(phone_normalized), products:deal_products(commission_value)',
    )
    .eq('status', 'won')
    .gte('won_at', startISO)
    .lt('won_at', endISO)
  if (wonDealsError) throw wonDealsError
  const wonDeals: DealRow[] = (
    (wonDealsData ?? []) as unknown as (Omit<DealRow, 'phone_normalized'> & { contact: ContactPhoneEmbed })[]
  ).map((d) => ({ ...d, phone_normalized: phoneFromEmbed(d.contact) }))

  const periodTotalDealsWon = wonDeals.length
  const periodTotalCommission = wonDeals.reduce((sum, d) => sum + dealCommission(d), 0)

  if (broadcasts.length === 0 && wonDeals.length === 0) {
    return {
      cards: computeRoiCards({
        cost: ZERO_COST,
        leadsGenerated: 0,
        dealsCreated: 0,
        wonDeals: [],
        periodTotalDealsWon: 0,
        periodTotalCommission: 0,
      }),
      rows: [],
      funnel: { sent: 0, replied: 0, dealsCreated: 0, dealsWon: 0 },
    }
  }

  const categoryByKey = new Map<string, string>()
  if (broadcasts.length > 0) {
    const { data: templates } = await db
      .from('message_templates')
      .select('name, language, category')
      .in('name', [...new Set(broadcasts.map((b) => b.template_name))])
    for (const t of (templates ?? []) as { name: string; language: string; category: string }[]) {
      categoryByKey.set(`${t.name}::${t.language}`, t.category)
    }
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
  const periodBroadcastIds = new Set(broadcastIds)

  // Deals created in the period feed the "created" funnel step — same
  // attribution rule, keyed off the deal's own created_at.
  const { data: createdDealsData, error: createdDealsError } = await db
    .from('deals')
    .select('id, contact_id, value, status, won_at, created_at, contact:contacts(phone_normalized)')
    .gte('created_at', startISO)
    .lt('created_at', endISO)
  if (createdDealsError) throw createdDealsError
  const createdDeals: DealRow[] = (
    (createdDealsData ?? []) as unknown as (Omit<DealRow, 'phone_normalized' | 'products'> & {
      contact: ContactPhoneEmbed
    })[]
  ).map((d) => ({ ...d, phone_normalized: phoneFromEmbed(d.contact), products: null }))

  const allCreatedAts = [...wonDeals.map((d) => d.created_at), ...createdDeals.map((d) => d.created_at)]
  const window = touchWindowFor(allCreatedAts)
  const touchesByPhone = window ? await loadTouchesByPhone(db, window) : new Map()

  const wonByBroadcast = new Map<string, AttributedWonDeal[]>()
  const allWonDeals: AttributedWonDeal[] = []
  for (const d of wonDeals) {
    const touch = d.phone_normalized ? findLastTouch(touchesByPhone.get(d.phone_normalized), d.created_at) : null
    if (!touch) continue
    const attributed: AttributedWonDeal = {
      commission: dealCommission(d),
      wonAt: d.won_at!,
      broadcastCreatedAt: touch.createdAt,
    }
    allWonDeals.push(attributed)
    if (periodBroadcastIds.has(touch.broadcastId)) {
      if (!wonByBroadcast.has(touch.broadcastId)) wonByBroadcast.set(touch.broadcastId, [])
      wonByBroadcast.get(touch.broadcastId)!.push(attributed)
    }
  }

  let dealsCreated = 0
  for (const d of createdDeals) {
    const touch = d.phone_normalized ? findLastTouch(touchesByPhone.get(d.phone_normalized), d.created_at) : null
    if (touch) dealsCreated++
  }

  const rows: BroadcastRoiRow[] = broadcasts.map((b) => {
    const won = wonByBroadcast.get(b.id) ?? []
    const commissionGenerated = won.reduce((sum, d) => sum + d.commission, 0)
    const cost = b.meta_total_cost
    return {
      id: b.id,
      name: b.name,
      templateCategory: categoryFor(b),
      sentCount: b.sent_count,
      cost,
      dealsWon: won.length,
      commissionGenerated,
      roiPct: cost > 0 ? ((commissionGenerated - cost) / cost) * 100 : null,
    }
  })

  // Aggregate cost + leads across every broadcast in the period —
  // unrelated to attribution, this is just "what was spent".
  let totalCost = ZERO_COST
  let totalLeads = 0
  for (const b of broadcasts) {
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
    dealsCreated,
    wonDeals: allWonDeals,
    periodTotalDealsWon,
    periodTotalCommission,
  })

  const totalSent = broadcasts.reduce((sum, b) => sum + b.sent_count, 0)
  const funnel = {
    sent: totalSent,
    replied: totalLeads,
    dealsCreated,
    dealsWon: allWonDeals.length,
  }

  return { cards, rows: rows.sort((a, b) => b.commissionGenerated - a.commissionGenerated), funnel }
}
