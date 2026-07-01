import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountReportCards, PeriodRange, ReportsBundle, UserReportRow } from './types'

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

  const [agentMsgsRes, allMsgsRes, wonDealsRes, membersRes] = await Promise.all([
    db
      .from('messages')
      .select('id, conversation_id, conversations!inner(assigned_agent_id)')
      .eq('sender_type', 'agent')
      .gte('created_at', startISO)
      .lt('created_at', endISO),
    db
      .from('messages')
      .select('conversation_id, sender_type, created_at')
      .gte('created_at', startISO)
      .lt('created_at', endISO)
      .order('conversation_id', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('deals')
      .select('id, value, assigned_to')
      .eq('status', 'won')
      .gte('won_at', startISO)
      .lt('won_at', endISO),
    db.from('profiles').select('id, user_id, full_name, email, account_role'),
  ])
  if (agentMsgsRes.error) throw agentMsgsRes.error
  if (allMsgsRes.error) throw allMsgsRes.error
  if (wonDealsRes.error) throw wonDealsRes.error
  if (membersRes.error) throw membersRes.error

  const agentMessages = (agentMsgsRes.data ?? []) as unknown as AgentMessageRow[]
  const wonDeals = (wonDealsRes.data ?? []) as WonDealRow[]
  const members = (membersRes.data ?? []) as MemberRow[]

  const cards: AccountReportCards = {
    messagesSent: agentMessages.length,
    conversationsHandled: new Set(agentMessages.map((m) => m.conversation_id)).size,
    dealsWon: wonDeals.length,
    valueWon: wonDeals.reduce((sum, d) => sum + (d.value ?? 0), 0),
    avgResponseMinutes: averageResponseMinutes((allMsgsRes.data ?? []) as RawMessageRow[]),
  }

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

  return { cards, users }
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
 */
function averageResponseMinutes(rows: RawMessageRow[]): number | null {
  let currentConv = ''
  let pendingCustomer: Date | null = null
  const diffsMinutes: number[] = []

  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      diffsMinutes.push((ts.getTime() - pendingCustomer.getTime()) / 60_000)
      pendingCustomer = null
    }
  }

  if (diffsMinutes.length === 0) return null
  return diffsMinutes.reduce((a, b) => a + b, 0) / diffsMinutes.length
}
