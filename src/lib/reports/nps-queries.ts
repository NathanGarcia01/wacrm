import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from '@/lib/dashboard/date-utils'
import type {
  NpsAgentRankingRow,
  NpsRatingDistributionPoint,
  NpsReportBundle,
  NpsReportCards,
  NpsReviewRow,
  NpsTrendPoint,
  PeriodRange,
} from './types'

type DB = SupabaseClient

interface SurveyRow {
  id: string
  sent_at: string
  responded_at: string | null
  rating: number | null
  comment: string | null
  status: string
  assigned_agent_id: string | null
  contact: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function loadNpsReport(db: DB, period: PeriodRange): Promise<NpsReportBundle> {
  const { startISO, endISO } = period

  const { data, error } = await db
    .from('nps_surveys')
    .select('id, sent_at, responded_at, rating, comment, status, assigned_agent_id, contact:contacts(name, phone)')
    .gte('sent_at', startISO)
    .lt('sent_at', endISO)
    .order('sent_at', { ascending: false })
  if (error) throw error

  const surveys = (data ?? []) as unknown as SurveyRow[]

  // assigned_agent_id has no FK to profiles (it mirrors
  // conversations.assigned_agent_id, a bare uuid), so PostgREST can't
  // embed it — resolve names with a second query instead.
  const agentIds = [...new Set(surveys.map((s) => s.assigned_agent_id).filter((id): id is string => !!id))]
  const agentMap = new Map<string, string>()
  if (agentIds.length > 0) {
    const { data: profiles } = await db
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', agentIds)
    for (const p of (profiles ?? []) as { user_id: string; full_name: string | null; email: string }[]) {
      agentMap.set(p.user_id, p.full_name || p.email)
    }
  }

  // "Responded" for these reports means the customer gave a rating —
  // the follow-up comment is optional, so gating on the DB's
  // status='responded' (comment-completed) would undercount replies.
  const rated = surveys.filter((s): s is SurveyRow & { rating: number } => s.rating != null)

  const cards: NpsReportCards = {
    avgRating: rated.length === 0 ? null : rated.reduce((sum, s) => sum + s.rating, 0) / rated.length,
    totalSent: surveys.length,
    totalResponded: rated.length,
    responseRatePct: surveys.length === 0 ? null : (rated.length / surveys.length) * 100,
  }

  const distMap = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])
  for (const s of rated) distMap.set(s.rating, (distMap.get(s.rating) ?? 0) + 1)
  const distribution: NpsRatingDistributionPoint[] = [1, 2, 3, 4, 5].map((rating) => ({
    rating: rating as 1 | 2 | 3 | 4 | 5,
    count: distMap.get(rating) ?? 0,
  }))

  const reviews: NpsReviewRow[] = surveys.slice(0, 100).map((s) => {
    const contact = one(s.contact)
    return {
      id: s.id,
      contactName: contact?.name || contact?.phone || null,
      rating: s.rating,
      comment: s.comment,
      agentName: s.assigned_agent_id ? (agentMap.get(s.assigned_agent_id) ?? null) : null,
      sentAt: s.sent_at,
      respondedAt: s.responded_at,
    }
  })

  const byAgent = new Map<string, { sum: number; count: number }>()
  for (const s of rated) {
    if (!s.assigned_agent_id) continue
    const row = byAgent.get(s.assigned_agent_id) ?? { sum: 0, count: 0 }
    row.sum += s.rating
    row.count += 1
    byAgent.set(s.assigned_agent_id, row)
  }
  const agentRanking: NpsAgentRankingRow[] = [...byAgent.entries()]
    .map(([userId, { sum, count }]) => ({
      userId,
      name: agentMap.get(userId) ?? 'Desconhecido',
      avgRating: count === 0 ? null : sum / count,
      totalResponses: count,
    }))
    .sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))

  const byDay = new Map<string, { sum: number; count: number }>()
  for (const s of rated) {
    const key = localDayKey(s.sent_at)
    const row = byDay.get(key) ?? { sum: 0, count: 0 }
    row.sum += s.rating
    row.count += 1
    byDay.set(key, row)
  }
  const trend: NpsTrendPoint[] = []
  const cursor = new Date(startISO)
  const end = new Date(endISO)
  while (cursor < end) {
    const key = localDayKey(cursor)
    const row = byDay.get(key)
    trend.push({ date: key, avgRating: row ? row.sum / row.count : null })
    cursor.setDate(cursor.getDate() + 1)
  }

  return { cards, distribution, reviews, agentRanking, trend }
}
