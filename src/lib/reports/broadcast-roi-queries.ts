import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAndSaveBroadcastCost } from '@/lib/broadcasts/meta-cost'
import type { BroadcastRoiBundle, BroadcastRoiCards, BroadcastRoiRow, PeriodRange } from './types'

type DB = SupabaseClient

interface BroadcastRow {
  id: string
  account_id: string
  name: string
  template_name: string
  template_language: string
  status: string
  sent_count: number
  meta_total_cost: number
  created_at: string
}

function roiPct(generated: number, cost: number): number | null {
  return cost > 0 ? ((generated - cost) / cost) * 100 : null
}

/**
 * Attribution rule mirrors the single-broadcast ROI card already
 * shipped on /broadcasts/[id]: a deal counts toward a broadcast's ROI
 * when its contact received that broadcast AND the deal was won
 * after the broadcast went out. A contact reached by several
 * broadcasts before winning can attribute the same deal to more than
 * one of them — there's no single source of truth for "which touch
 * actually closed it", so this deliberately over-counts rather than
 * arbitrarily picking one.
 */
export async function loadBroadcastRoiReport(db: DB, period: PeriodRange): Promise<BroadcastRoiBundle> {
  const { startISO, endISO } = period

  const { data, error } = await db
    .from('broadcasts')
    .select(
      'id, account_id, name, template_name, template_language, status, sent_count, meta_total_cost, created_at',
    )
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .order('created_at', { ascending: false })
  if (error) throw error

  const broadcasts = (data ?? []) as BroadcastRow[]
  if (broadcasts.length === 0) {
    return { cards: { totalInvested: 0, totalGenerated: 0, roiPct: null }, rows: [] }
  }

  const categoryByKey = new Map<string, string>()
  const { data: templates } = await db
    .from('message_templates')
    .select('name, language, category')
    .in(
      'name',
      [...new Set(broadcasts.map((b) => b.template_name))],
    )
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

  let wonDeals: { contact_id: string; value: number; won_at: string }[] = []
  if (allContactIds.size > 0) {
    const { data: deals } = await db
      .from('deals')
      .select('contact_id, value, won_at')
      .in('contact_id', [...allContactIds])
      .eq('status', 'won')
      .not('won_at', 'is', null)
    wonDeals = (deals ?? []) as { contact_id: string; value: number; won_at: string }[]
  }

  const rows: BroadcastRoiRow[] = broadcasts.map((b) => {
    const contacts = contactsByBroadcast.get(b.id) ?? new Set<string>()
    const attributed = wonDeals.filter((d) => contacts.has(d.contact_id) && d.won_at > b.created_at)
    const valueGenerated = attributed.reduce((sum, d) => sum + (d.value ?? 0), 0)
    return {
      id: b.id,
      name: b.name,
      templateCategory: categoryFor(b),
      sentCount: b.sent_count,
      cost: b.meta_total_cost,
      dealsWon: attributed.length,
      valueGenerated,
      roiPct: roiPct(valueGenerated, b.meta_total_cost),
    }
  })

  const totalInvested = rows.reduce((sum, r) => sum + r.cost, 0)
  const totalGenerated = rows.reduce((sum, r) => sum + r.valueGenerated, 0)

  const cards: BroadcastRoiCards = {
    totalInvested,
    totalGenerated,
    roiPct: roiPct(totalGenerated, totalInvested),
  }

  return { cards, rows: rows.sort((a, b) => b.valueGenerated - a.valueGenerated) }
}
