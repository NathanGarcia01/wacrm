import type { SupabaseClient } from '@supabase/supabase-js'
import type { BroadcastReportCards, BroadcastReportRow, BroadcastsReportBundle, PeriodRange } from './types'

type DB = SupabaseClient

interface BroadcastRow {
  id: string
  name: string
  template_name: string
  created_at: string
  total_recipients: number
  delivered_count: number
  failed_count: number
  replied_count: number
}

export async function loadBroadcastsReport(db: DB, period: PeriodRange): Promise<BroadcastsReportBundle> {
  const { startISO, endISO } = period

  // The `broadcasts` table already keeps live aggregate counters
  // (total_recipients/delivered_count/failed_count/replied_count),
  // kept in sync by the send worker and the webhook's
  // flagBroadcastReplyIfAny — no need to re-derive them from
  // broadcast_recipients here.
  const { data, error } = await db
    .from('broadcasts')
    .select('id, name, template_name, created_at, total_recipients, delivered_count, failed_count, replied_count')
    .gte('created_at', startISO)
    .lt('created_at', endISO)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as BroadcastRow[]

  const totalRecipients = rows.reduce((sum, b) => sum + b.total_recipients, 0)
  const delivered = rows.reduce((sum, b) => sum + b.delivered_count, 0)
  const failed = rows.reduce((sum, b) => sum + b.failed_count, 0)
  const replied = rows.reduce((sum, b) => sum + b.replied_count, 0)

  const cards: BroadcastReportCards = {
    totalBroadcasts: rows.length,
    uniqueRecipients: totalRecipients,
    delivered,
    failed,
    deliveryRatePct: totalRecipients === 0 ? null : (delivered / totalRecipients) * 100,
    replyRatePct: totalRecipients === 0 ? null : (replied / totalRecipients) * 100,
  }

  const broadcasts: BroadcastReportRow[] = rows.map((b) => ({
    id: b.id,
    name: b.name,
    templateName: b.template_name,
    createdAt: b.created_at,
    totalRecipients: b.total_recipients,
    deliveredCount: b.delivered_count,
    failedCount: b.failed_count,
    repliedCount: b.replied_count,
    replyRatePct: b.total_recipients === 0 ? null : (b.replied_count / b.total_recipients) * 100,
  }))

  return { cards, broadcasts }
}
