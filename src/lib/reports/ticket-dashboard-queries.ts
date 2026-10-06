import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  TicketDashboardBundle,
  TicketDashboardFilterOptions,
  TicketsPerDayPoint,
} from './types'
import type { TicketDashboardPeriodRange } from './ticket-dashboard-period'
import { bucketKeysForPeriod } from './bucket-fill'

type DB = SupabaseClient

interface RpcCards {
  total_tickets: number
  initiated_by_customer: number
  initiated_by_company: number
  pending: number
  in_progress: number
  agents_count: number
  contacts_served: number
  new_contacts: number
  new_contacts_engaged: number
  tma_seconds: number | null
  first_response_seconds: number | null
}

interface RpcResult {
  filters: {
    business_hours_configured: boolean
    granularity: "hour" | "day"
  }
  cards: RpcCards
  charts: {
    by_channel: { channel_id: string | null; channel_name: string | null; count: number }[]
    by_source: { source: string; count: number }[]
    by_closing_reason: { closing_reason_id: string | null; label: string | null; count: number }[]
    by_department: { department_id: string | null; name: string | null; count: number }[]
    daily: { date: string; count: number }[]
  }
}

export async function loadTicketDashboard(
  db: DB,
  params: {
    accountId: string
    period: TicketDashboardPeriodRange
    timezone: string
    userId: string | null
    departmentId: string | null
    channelId: string | null
    businessHours: boolean
  },
): Promise<TicketDashboardBundle> {
  const { data, error } = await db.rpc('get_ticket_dashboard', {
    p_account_id: params.accountId,
    p_start: params.period.startISO,
    p_end: params.period.endISO,
    p_user_id: params.userId,
    p_department_id: params.departmentId,
    p_channel_id: params.channelId,
    p_business_hours: params.businessHours,
  })
  if (error) throw error

  const result = data as RpcResult
  const granularity = result.filters.granularity

  // The RPC only emits a row per bucket that actually had ticket
  // activity — fill the gaps so the chart doesn't misrepresent a
  // zero-ticket bucket as missing data (same convention as
  // buildMessagesPerDay in queries.ts).
  const byBucket = new Map(result.charts.daily.map((d) => [d.date, d.count]))
  const daily: TicketsPerDayPoint[] = bucketKeysForPeriod(granularity, params.period, params.timezone).map(
    (key) => ({ date: key, count: byBucket.get(key) ?? 0 }),
  )

  return {
    businessHoursConfigured: result.filters.business_hours_configured,
    granularity,
    cards: {
      totalTickets: result.cards.total_tickets,
      initiatedByCustomer: result.cards.initiated_by_customer,
      initiatedByCompany: result.cards.initiated_by_company,
      pending: result.cards.pending,
      inProgress: result.cards.in_progress,
      agentsCount: result.cards.agents_count,
      contactsServed: result.cards.contacts_served,
      newContacts: result.cards.new_contacts,
      newContactsEngaged: result.cards.new_contacts_engaged,
      tmaSeconds: result.cards.tma_seconds,
      firstResponseSeconds: result.cards.first_response_seconds,
    },
    charts: {
      byChannel: result.charts.by_channel.map((c) => ({
        channelId: c.channel_id,
        channelName: c.channel_name,
        count: c.count,
      })),
      bySource: result.charts.by_source.map((s) => ({ source: s.source, count: s.count })),
      byClosingReason: result.charts.by_closing_reason.map((c) => ({
        closingReasonId: c.closing_reason_id,
        label: c.label,
        count: c.count,
      })),
      byDepartment: result.charts.by_department.map((d) => ({
        departmentId: d.department_id,
        name: d.name,
        count: d.count,
      })),
      daily,
    },
  }
}

interface AgentRow {
  user_id: string
  full_name: string | null
  email: string
}

interface DepartmentRow {
  id: string
  name: string
}

interface ChannelRow {
  id: string
  name: string
}

/** Options for the tab's user/department/channel filter dropdowns.
 *  Agents = every account member (same `profiles` source as the rest
 *  of Reports — see queries.ts) rather than only agents currently
 *  assigned a ticket, so a filter stays available even for a member
 *  with zero tickets in the selected period. */
export async function loadTicketDashboardFilterOptions(db: DB): Promise<TicketDashboardFilterOptions> {
  const [agentsRes, departmentsRes, channelsRes] = await Promise.all([
    db.from('profiles').select('user_id, full_name, email'),
    db.from('departments').select('id, name').eq('is_active', true).order('name'),
    db.from('whatsapp_channels').select('id, name').eq('is_active', true).order('name'),
  ])
  if (agentsRes.error) throw agentsRes.error
  if (departmentsRes.error) throw departmentsRes.error
  if (channelsRes.error) throw channelsRes.error

  const agents = ((agentsRes.data ?? []) as AgentRow[]).map((a) => ({
    userId: a.user_id,
    name: a.full_name || a.email,
  }))
  const departments = (departmentsRes.data ?? []) as DepartmentRow[]
  const channels = (channelsRes.data ?? []) as ChannelRow[]

  return { agents, departments, channels }
}
