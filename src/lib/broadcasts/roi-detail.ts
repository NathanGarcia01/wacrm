import type { SupabaseClient } from '@supabase/supabase-js'
import { findLastTouch, loadTouchesByPhone, touchWindowFor } from './attribution'
import { computeAndSaveBroadcastCost } from './meta-cost'
import { computeRoiCards, costBreakdown } from './roi-metrics'
import type { AttributedWonDeal } from './roi-metrics'
import type { BroadcastRoiDealRow, BroadcastRoiDetail } from '@/lib/reports/types'

type DB = SupabaseClient

interface DealRow {
  id: string
  title: string
  contact_id: string
  value: number
  status: string
  won_at: string | null
  created_at: string
  contact: { name: string | null; phone: string | null; phone_normalized: string | null } | { name: string | null; phone: string | null; phone_normalized: string | null }[] | null
  products: { commission_value: number | null }[] | null
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * Expanded ROI for a single broadcast — used by /broadcasts/[id].
 * Same last-touch/30-day/phone attribution rule as the aggregate
 * reports (src/lib/broadcasts/attribution.ts) and Pipeline & Vendas'
 * campaign attribution, just scoped to "is THIS broadcast the last
 * touch" instead of "which broadcast is the last touch" — kept as a
 * separate query (rather than calling the aggregate one with a
 * 1-broadcast period) because this needs the per-deal table rows the
 * aggregate report doesn't.
 */
export async function loadBroadcastRoiDetail(db: DB, broadcastId: string): Promise<BroadcastRoiDetail> {
  const { data: broadcast, error } = await db
    .from('broadcasts')
    .select(
      'id, account_id, template_name, template_language, status, sent_count, replied_count, meta_total_cost, meta_cost_marketing, meta_cost_utility, meta_cost_authentication, created_at',
    )
    .eq('id', broadcastId)
    .single()
  if (error) throw error

  const { data: template } = await db
    .from('message_templates')
    .select('category')
    .eq('account_id', broadcast.account_id)
    .eq('name', broadcast.template_name)
    .eq('language', broadcast.template_language || 'en_US')
    .maybeSingle()
  const category = (template as { category: string } | null)?.category ?? null

  if (broadcast.status === 'sent' && broadcast.meta_total_cost === 0 && broadcast.sent_count > 0) {
    broadcast.meta_total_cost = await computeAndSaveBroadcastCost(db, {
      broadcastId: broadcast.id,
      accountId: broadcast.account_id,
      templateCategory: category,
      sentCount: broadcast.sent_count,
    })
    // Rates were just (re)computed by computeAndSaveBroadcastCost — read
    // them back so the cost breakdown below reflects the fresh values
    // instead of the stale zeros this branch started with.
    const { data: refreshed } = await db
      .from('broadcasts')
      .select('meta_cost_marketing, meta_cost_utility, meta_cost_authentication')
      .eq('id', broadcastId)
      .single()
    if (refreshed) Object.assign(broadcast, refreshed)
  }

  const cost = costBreakdown({
    category,
    sentCount: broadcast.sent_count,
    rateMarketing: broadcast.meta_cost_marketing,
    rateUtility: broadcast.meta_cost_utility,
    rateAuthentication: broadcast.meta_cost_authentication,
  })

  // Phones this broadcast actually reached — the attribution key, not
  // contact_id, so a contact re-imported under a new id after the
  // send still resolves back to the same touch.
  const { data: recipients } = await db
    .from('broadcast_recipients')
    .select('contact:contacts(phone_normalized)')
    .eq('broadcast_id', broadcastId)
    .in('status', ['sent', 'delivered', 'read', 'replied'])
    .not('contact_id', 'is', null)
  const reachedPhones = [
    ...new Set(
      ((recipients ?? []) as { contact: { phone_normalized: string | null } | { phone_normalized: string | null }[] | null }[])
        .map((r) => one(r.contact)?.phone_normalized)
        .filter((p): p is string => Boolean(p)),
    ),
  ]

  let deals: DealRow[] = []
  if (reachedPhones.length > 0) {
    const { data: contactsData } = await db.from('contacts').select('id').in('phone_normalized', reachedPhones)
    const candidateContactIds = [...new Set((contactsData ?? []).map((c) => c.id as string))]
    if (candidateContactIds.length > 0) {
      const { data: dealsData } = await db
        .from('deals')
        .select(
          'id, title, contact_id, value, status, won_at, created_at, contact:contacts(name, phone, phone_normalized), products:deal_products(commission_value)',
        )
        .in('contact_id', candidateContactIds)
      deals = (dealsData ?? []) as unknown as DealRow[]
    }
  }

  const dealCommission = (d: DealRow) =>
    (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)

  // Resolve, for every candidate deal, whether THIS broadcast is its
  // last touch within the attribution window — a deal only shows up
  // here if no later broadcast to the same phone takes credit first.
  const window = touchWindowFor(deals.map((d) => d.created_at))
  const touchesByPhone = window ? await loadTouchesByPhone(db, window) : new Map()
  const isAttributedToThisBroadcast = (d: DealRow): boolean => {
    const phone = one(d.contact)?.phone_normalized
    if (!phone) return false
    const touch = findLastTouch(touchesByPhone.get(phone), d.created_at)
    return touch?.broadcastId === broadcastId
  }

  const dealsCreated = deals.filter(isAttributedToThisBroadcast)

  const wonDealRows = dealsCreated.filter((d) => d.status === 'won' && d.won_at)
  const wonDeals: AttributedWonDeal[] = wonDealRows.map((d) => ({
    commission: dealCommission(d),
    wonAt: d.won_at!,
    broadcastCreatedAt: broadcast.created_at,
  }))

  const cards = computeRoiCards({
    cost,
    leadsGenerated: broadcast.replied_count,
    dealsCreated: dealsCreated.length,
    wonDeals,
    periodTotalDealsWon: wonDeals.length,
    periodTotalCommission: wonDeals.reduce((sum, d) => sum + d.commission, 0),
  })

  const funnel = {
    sent: broadcast.sent_count,
    replied: broadcast.replied_count,
    dealsCreated: dealsCreated.length,
    dealsWon: wonDeals.length,
  }

  const dealRows: BroadcastRoiDealRow[] = wonDealRows
    .map((d) => {
      const contact = one(d.contact)
      return {
        id: d.id,
        dealTitle: d.title,
        contactName: contact?.name || contact?.phone || null,
        value: d.value ?? 0,
        commission: dealCommission(d),
        closedAt: d.won_at,
      }
    })
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))

  return { cards, funnel, deals: dealRows }
}
