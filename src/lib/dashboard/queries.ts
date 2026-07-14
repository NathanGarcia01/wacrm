import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  NpsSummary,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'
import type { PeriodRange } from '../reports/types'

// ------------------------------------------------------------
// All client-side aggregation. RLS scopes every query to the
// signed-in user automatically, so we never pass user_id explicitly
// here. Perf is acceptable for the current scale (low thousands of
// messages) — if a tenant's dataset outgrows this, we'd migrate the
// heavy aggregations to SQL RPCs. Noted in the PR.
// ------------------------------------------------------------

type DB = SupabaseClient

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(db: DB, period: PeriodRange): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  // "Previous period" = the immediately preceding window of the same
  // length as the selected one — e.g. selecting "this month" compares
  // against the prior 30-ish days, not literally last calendar month.
  const periodMs = new Date(period.endISO).getTime() - new Date(period.startISO).getTime()
  const previousStartISO = new Date(new Date(period.startISO).getTime() - periodMs).toISOString()
  const previousEndISO = period.startISO

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    openDeals,
    newContactsCur,
    newContactsPrev,
    messagesCur,
    messagesPrev,
    npsSurveysInPeriod,
  ] = await Promise.all([
    // Live snapshots — deliberately NOT period-scoped (see MetricsBundle).
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gte('created_at', todayStart),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
    db.from('deals').select('value, status').eq('status', 'open'),
    // Period-scoped flow metrics.
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', period.startISO)
      .lt('created_at', period.endISO),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', previousStartISO)
      .lt('created_at', previousEndISO),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', period.startISO)
      .lt('created_at', period.endISO),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', previousStartISO)
      .lt('created_at', previousEndISO),
    db
      .from('nps_surveys')
      .select('rating')
      .gte('sent_at', period.startISO)
      .lt('sent_at', period.endISO),
  ])

  const openDealsRows = (openDeals.data ?? []) as { value: number | null }[]
  const openDealsValue = openDealsRows.reduce((sum, d) => sum + (d.value ?? 0), 0)

  const npsRows = (npsSurveysInPeriod.data ?? []) as { rating: number | null }[]
  const npsRated = npsRows.filter((r) => r.rating != null)
  const nps: NpsSummary = {
    avgRating:
      npsRated.length === 0
        ? null
        : npsRated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / npsRated.length,
    totalResponses: npsRated.length,
    responseRatePct: npsRows.length === 0 ? null : (npsRated.length / npsRows.length) * 100,
  }

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      // Deliberately NOT period-scoped, same as the current count above.
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContacts: {
      current: newContactsCur.count ?? 0,
      previous: newContactsPrev.count ?? 0,
    },
    openDealsValue,
    openDealsCount: openDealsRows.length,
    messagesSent: {
      current: messagesCur.count ?? 0,
      previous: messagesPrev.count ?? 0,
    },
    nps,
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('created_at, sender_type')
    .gte('created_at', start)
    .order('created_at', { ascending: true })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = localDayKey(row.created_at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1 // agent + bot both count as outgoing
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(db: DB): Promise<PipelineDonutData> {
  const [stagesRes, dealsRes] = await Promise.all([
    db.from('pipeline_stages').select('id, name, color, pipeline_id, position').order('position'),
    db.from('deals').select('stage_id, value, status').eq('status', 'open'),
  ])

  const stages =
    (stagesRes.data ?? []) as { id: string; name: string; color: string }[]
  const deals = (dealsRes.data ?? []) as { stage_id: string; value: number | null }[]

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    // Hide empty stages from the ring (but we'd still show them in the
    // legend if the user wanted a full breakdown — trimming keeps the
    // visual clean for the common case).
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(db: DB, period: PeriodRange): Promise<ResponseTimeSummary> {
  // Pull messages for the selected period PLUS the immediately
  // preceding period of equal length in one shot (so the header's
  // "current vs previous" comparison doesn't need a second round
  // trip), then walk per conversation to find each "first inbound" →
  // "first subsequent outbound" pair.
  const periodMs = new Date(period.endISO).getTime() - new Date(period.startISO).getTime()
  const previousStartISO = new Date(new Date(period.startISO).getTime() - periodMs).toISOString()

  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', previousStartISO)
    .lt('created_at', period.endISO)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Group per conversation, pair unreplied customer messages with the
  // next outbound message from the agent/bot. A single customer message
  // can only count once (avoids inflating averages if the customer
  // double-messages while the agent takes time to reply).
  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const periodStart = new Date(period.startISO)
  const periodEnd = new Date(period.endISO)

  // Per-day-of-week buckets, built ONLY from the selected period (mixing
  // in the comparison window would blend two different date ranges into
  // one chart). If a day has no samples its avgMinutes stays null and
  // the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const currentPeriodMins: number[] = []
  const previousPeriodMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    if (s.customerAt >= periodStart && s.customerAt < periodEnd) {
      byDow.get(mondayIndex(s.customerAt))!.push(diffMin)
      currentPeriodMins.push(diffMin)
    } else if (s.customerAt < periodStart) {
      previousPeriodMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  // Silence unused-label warnings — keep the arrays explicitly named
  // for readability above.
  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    currentPeriodAvg: avg(currentPeriodMins),
    previousPeriodAvg: avg(previousPeriodMins),
  }
}

// --- 5. Activity feed --------------------------------------------------

/** Translator shape accepted by `loadActivity` — matches next-intl's `useTranslations` return type. */
export type ActivityT = (key: string, values?: Record<string, string | number | Date>) => string

/** English fallback used when no translator is supplied. */
const defaultActivityT: ActivityT = (key, values) => {
  const dict: Record<string, string> = {
    activityUnknownContact: 'Unknown',
    activityAContact: 'a contact',
    activityAutomationFallback: 'Automation',
    activityMessageFrom: `New message from ${values?.who}`,
    activityNewContact: `New contact: ${values?.who}`,
    activityDealInStage: `Deal "${values?.title}" in ${values?.stage}`,
    activityDealUpdated: `Deal "${values?.title}" updated`,
    activityBroadcastSentTo: `sent to ${values?.count} contacts`,
    activityBroadcastStatus: `${values?.status} (${values?.count} recipients)`,
    activityBroadcastLine: `Broadcast "${values?.name}" ${values?.detail}`,
    activityAutomationTriggered: `Automation "${values?.name}" triggered for ${values?.who}`,
    activityAutomationFailed: `Automation "${values?.name}" failed for ${values?.who}`,
  }
  return dict[key] ?? ''
}

export async function loadActivity(
  db: DB,
  limit = 20,
  t: ActivityT = defaultActivityT,
): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('automation_logs')
      .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || t('activityUnknownContact')
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: t('activityMessageFrom', { who }),
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: t('activityNewContact', { who: c.name || c.phone }),
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? t('activityDealInStage', { title: d.title, stage: stage.name })
        : t('activityDealUpdated', { title: d.title }),
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const label =
      b.status === 'sent'
        ? t('activityBroadcastSentTo', { count: b.total_recipients })
        : t('activityBroadcastStatus', { status: b.status, count: b.total_recipients })
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: t('activityBroadcastLine', { name: b.name, detail: label }),
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || t('activityAContact')
    const autoName = automation?.name || t('activityAutomationFallback')
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text:
        l.status === 'failed'
          ? t('activityAutomationFailed', { name: autoName, who })
          : t('activityAutomationTriggered', { name: autoName, who }),
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
