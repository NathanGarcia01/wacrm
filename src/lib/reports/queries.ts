import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from '@/lib/dashboard/date-utils'
import { fetchAllRows } from './paginate'
import type {
  AccountReportCards,
  MessagesPerDayPoint,
  PeriodRange,
  ReportsBundle,
  UserReportRow,
} from './types'

// ------------------------------------------------------------
// All client-side aggregation, same convention as
// src/lib/dashboard/queries.ts — RLS scopes every query to the
// signed-in user's account automatically, so no account_id filter
// is passed explicitly.
//
// Two different FKs into `profiles` are in play here and must not be
// confused (see the task brief):
//   - conversations.assigned_agent_id → profiles.user_id
//   - deals.assigned_to               → profiles.id
// Both `messages` (via its conversation) and `deals` are joined to
// `profiles` in JS below, keyed on the correct column for each.
// ------------------------------------------------------------

type DB = SupabaseClient

interface AgentMessageRow {
  id: string
  conversation_id: string
  // PostgREST returns a to-one embed as an object OR (depending on
  // how the relationship is inferred) a single-element array — this
  // is a to-one edge (each message belongs to exactly one
  // conversation), but we still normalise both shapes defensively,
  // mirroring the pattern in dashboard/queries.ts.
  conversations:
    | { assigned_agent_id: string | null }
    | { assigned_agent_id: string | null }[]
    | null
}

interface WonDealRow {
  id: string
  value: number | null
  assigned_to: string | null
}

interface MemberRow {
  id: string
  user_id: string
  full_name: string | null
  email: string
  account_role: string | null
}

interface RawMessageRow {
  conversation_id: string
  sender_type: string
  created_at: string
}

export async function loadReportsBundle(db: DB, period: PeriodRange): Promise<ReportsBundle> {
  const { startISO, endISO } = period

  // Paginated — a busy account easily sends/receives more than 1000
  // messages in a month, and a plain unbounded `.from(...)` fetch
  // silently stops at PostgREST's implicit 1000-row cap (confirmed in
  // production: October's "Mensagens enviadas"/"recebidas" cards were
  // stuck at 686/314, summing to exactly 1000, against a real
  // 1771/898). `wonDealsRes`/`membersRes` stay plain fetches — won
  // deals in a single period and account members are both ordersof-
  // magnitude away from that cap.
  const [agentMessages, allMessages, wonDealsRes, membersRes] = await Promise.all([
    fetchAllRows<AgentMessageRow>((from, to) =>
      db
        .from('messages')
        .select('id, conversation_id, conversations!inner(assigned_agent_id)')
        .eq('sender_type', 'agent')
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: AgentMessageRow[] | null; error: unknown }>,
    ),
    fetchAllRows<RawMessageRow>((from, to) =>
      db
        .from('messages')
        .select('conversation_id, sender_type, created_at')
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .order('conversation_id', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: RawMessageRow[] | null; error: unknown }>,
    ),
    db
      .from('deals')
      .select('id, value, assigned_to')
      .eq('status', 'won')
      .gte('won_at', startISO)
      .lt('won_at', endISO),
    db.from('profiles').select('id, user_id, full_name, email, account_role'),
  ])
  if (wonDealsRes.error) throw wonDealsRes.error
  if (membersRes.error) throw membersRes.error

  const wonDeals = (wonDealsRes.data ?? []) as WonDealRow[]
  const members = (membersRes.data ?? []) as MemberRow[]

  const responseMetrics = computeResponseMetrics(allMessages)

  // Card/chart totals count every outbound message — agent AND bot
  // (flow/automation-sent) — since both are real sent messages from
  // the account's point of view. Per-agent attribution below stays
  // agent-only: a bot message has no human agent to credit.
  const outboundMessages = allMessages.filter((m) => m.sender_type === 'agent' || m.sender_type === 'bot')

  const cards: AccountReportCards = {
    messagesSent: outboundMessages.length,
    messagesReceived: allMessages.filter((m) => m.sender_type === 'customer').length,
    conversationsHandled: new Set(outboundMessages.map((m) => m.conversation_id)).size,
    dealsWon: wonDeals.length,
    valueWon: wonDeals.reduce((sum, d) => sum + (d.value ?? 0), 0),
    avgResponseMinutes: responseMetrics.avgResponseMinutes,
    responseRatePct: responseMetrics.responseRatePct,
  }

  const memberUserIds = new Set(members.map((m) => m.user_id))
  const memberProfileIds = new Set(members.map((m) => m.id))

  const users: UserReportRow[] = members.map((member) => {
    const userMessages = agentMessages.filter((m) => assignedAgentOf(m) === member.user_id)
    const userDeals = wonDeals.filter((d) => d.assigned_to === member.id)
    return {
      userId: member.user_id,
      profileId: member.id,
      name: member.full_name || member.email,
      email: member.email,
      messagesSent: userMessages.length,
      conversationsHandled: new Set(userMessages.map((m) => m.conversation_id)).size,
      dealsWon: userDeals.length,
      valueWon: userDeals.reduce((sum, d) => sum + (d.value ?? 0), 0),
    }
  })

  // "Sem responsável" — everything the cards above count that isn't
  // attributable to a CURRENT member: bot messages (agentMessages only
  // ever holds sender_type='agent' rows, so a bot message never
  // appears there), agent messages in a conversation with no assigned
  // agent (or one assigned to a profile that no longer exists),  and
  // won deals with no assignee. Without this row the table's sum fell
  // short of the cards above whenever any deal/conversation had no
  // owner — confirmed live: 4 of this account's 8 won deals this
  // month have assigned_to = null.
  const unattributedAgentMessages = agentMessages.filter((m) => {
    const agentUserId = assignedAgentOf(m)
    return agentUserId == null || !memberUserIds.has(agentUserId)
  })
  const botMessages = allMessages.filter((m) => m.sender_type === 'bot')
  const unassignedConversationIds = new Set([
    ...unattributedAgentMessages.map((m) => m.conversation_id),
    ...botMessages.map((m) => m.conversation_id),
  ])
  const unassignedDeals = wonDeals.filter((d) => d.assigned_to == null || !memberProfileIds.has(d.assigned_to))

  if (unattributedAgentMessages.length + botMessages.length + unassignedDeals.length > 0) {
    users.push({
      userId: null,
      profileId: null,
      // Resolved to a translated "Sem responsável" by the component
      // (same null-sentinel convention as SlaAgentRankingRow/
      // UserSummaryRow) — this lib file has no i18n access.
      name: '',
      email: '',
      messagesSent: unattributedAgentMessages.length + botMessages.length,
      conversationsHandled: unassignedConversationIds.size,
      dealsWon: unassignedDeals.length,
      valueWon: unassignedDeals.reduce((sum, d) => sum + (d.value ?? 0), 0),
    })
  }

  return { cards, users, messagesPerDay: buildMessagesPerDay(allMessages, period) }
}

function assignedAgentOf(msg: AgentMessageRow): string | null {
  const conv = Array.isArray(msg.conversations) ? msg.conversations[0] : msg.conversations
  return conv?.assigned_agent_id ?? null
}

/**
 * Account-wide average first-response time within the period: pairs
 * each unreplied customer message with the next outbound (agent or
 * bot) message in the same conversation. `sender_id` isn't reliable
 * enough to attribute this per-agent (see the task brief) — this
 * average is intentionally account-scoped only.
 *
 * Also derives the response rate: of the conversations an agent (or
 * bot) sent at least one message in during the period, what
 * percentage saw the customer reply afterward (within the period)?
 * Both metrics walk the same conversation-ordered, time-ordered rows
 * in one pass to avoid a second grouping pass over the data.
 */
function computeResponseMetrics(rows: RawMessageRow[]): {
  avgResponseMinutes: number | null
  responseRatePct: number | null
} {
  let currentConv = ''
  let pendingCustomer: Date | null = null
  const diffsMinutes: number[] = []
  const contactedConversations = new Set<string>()
  const repliedConversations = new Set<string>()
  let lastOutboundConv: string | null = null

  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
      lastOutboundConv = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
      if (lastOutboundConv === row.conversation_id) {
        repliedConversations.add(row.conversation_id)
      }
    } else {
      contactedConversations.add(row.conversation_id)
      lastOutboundConv = row.conversation_id
      if (pendingCustomer) {
        diffsMinutes.push((ts.getTime() - pendingCustomer.getTime()) / 60_000)
        pendingCustomer = null
      }
    }
  }

  const avgResponseMinutes =
    diffsMinutes.length === 0
      ? null
      : diffsMinutes.reduce((a, b) => a + b, 0) / diffsMinutes.length

  const responseRatePct =
    contactedConversations.size === 0
      ? null
      : (repliedConversations.size / contactedConversations.size) * 100

  return { avgResponseMinutes, responseRatePct }
}

/**
 * One point per calendar day in the period (local timezone), even
 * days with zero messages — a LineChart with gaps at zero-message
 * days would otherwise misrepresent the trend as missing data.
 */
function buildMessagesPerDay(rows: RawMessageRow[], period: PeriodRange): MessagesPerDayPoint[] {
  const byDay = new Map<string, { sent: number; received: number }>()
  for (const row of rows) {
    if (row.sender_type !== 'agent' && row.sender_type !== 'bot' && row.sender_type !== 'customer') continue
    const key = localDayKey(row.created_at)
    const bucket = byDay.get(key) ?? { sent: 0, received: 0 }
    if (row.sender_type === 'customer') bucket.received++
    else bucket.sent++
    byDay.set(key, bucket)
  }

  const points: MessagesPerDayPoint[] = []
  const cursor = new Date(period.startISO)
  const end = new Date(period.endISO)
  while (cursor < end) {
    const key = localDayKey(cursor)
    const bucket = byDay.get(key) ?? { sent: 0, received: 0 }
    points.push({ date: key, ...bucket })
    cursor.setDate(cursor.getDate() + 1)
  }
  return points
}
