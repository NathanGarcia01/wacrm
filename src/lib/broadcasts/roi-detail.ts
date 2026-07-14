import type { SupabaseClient } from '@supabase/supabase-js'
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
  contact: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
  products: { commission_value: number | null }[] | null
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * Expanded ROI for a single broadcast — used by /broadcasts/[id]. Same
 * attribution + commission math as loadBroadcastRoiReport (the period
 * aggregate in Reports), just scoped to one broadcast instead of
 * summed across many. Kept as a separate query (rather than calling
 * the aggregate one with a 1-broadcast period) because this needs the
 * per-deal table rows the aggregate report doesn't.
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

  const { data: recipients } = await db
    .from('broadcast_recipients')
    .select('contact_id')
    .eq('broadcast_id', broadcastId)
    .not('contact_id', 'is', null)
  const contactIds = [...new Set((recipients ?? []).map((r) => r.contact_id as string))]

  let deals: DealRow[] = []
  if (contactIds.length > 0) {
    const { data: dealsData } = await db
      .from('deals')
      .select(
        'id, title, contact_id, value, status, won_at, created_at, contact:contacts(name, phone), products:deal_products(commission_value)',
      )
      .in('contact_id', contactIds)
      .gt('created_at', broadcast.created_at)
    deals = (dealsData ?? []) as unknown as DealRow[]
  }

  const dealCommission = (d: DealRow) =>
    (d.products ?? []).reduce((sum, p) => sum + (p.commission_value ?? 0), 0)

  const wonDeals: AttributedWonDeal[] = deals
    .filter((d) => d.status === 'won' && d.won_at)
    .map((d) => ({ commission: dealCommission(d), wonAt: d.won_at!, broadcastCreatedAt: broadcast.created_at }))

  const cards = computeRoiCards({
    cost,
    leadsGenerated: broadcast.replied_count,
    dealsCreated: deals.length,
    wonDeals,
  })

  const funnel = {
    sent: broadcast.sent_count,
    replied: broadcast.replied_count,
    dealsCreated: deals.length,
    dealsWon: wonDeals.length,
  }

  const dealRows: BroadcastRoiDealRow[] = deals
    .filter((d) => d.status === 'won')
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
