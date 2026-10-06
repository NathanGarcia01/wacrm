import type { SupabaseClient } from '@supabase/supabase-js'
import type { SlaDailyPoint, SlaDashboardBundle, SlaMetricCounts } from './types'
import type { TicketDashboardPeriodRange } from './ticket-dashboard-period'
import { bucketKeysForPeriod } from './bucket-fill'

type DB = SupabaseClient

interface RpcResult {
  filters: {
    granularity: "hour" | "day"
    first_response_goal_minutes: number | null
    first_response_business_hours: boolean
    resolution_goal_minutes: number | null
    resolution_business_hours: boolean
  }
  cards: {
    fr_total: number
    fr_within: number
    res_total: number
    res_within: number
  }
  charts: {
    daily: {
      date: string
      fr_total: number
      fr_within: number
      res_total: number
      res_within: number
    }[]
  }
  agent_ranking: {
    agent_id: string | null
    fr_total: number
    fr_within: number
    res_total: number
    res_within: number
  }[]
  at_risk: {
    ticket_id: string
    conversation_id: string
    protocol_number: number
    contact_name: string | null
    department_name: string | null
    agent_id: string | null
    opened_at: string
    pct_elapsed: number
  }[]
}

function metric(total: number, within: number): SlaMetricCounts {
  return { total, withinGoal: within }
}

export async function loadSlaDashboard(
  db: DB,
  params: {
    accountId: string
    period: TicketDashboardPeriodRange
    timezone: string
    userId: string | null
    departmentId: string | null
    channelId: string | null
  },
): Promise<SlaDashboardBundle> {
  const { data, error } = await db.rpc('get_sla_dashboard', {
    p_account_id: params.accountId,
    p_start: params.period.startISO,
    p_end: params.period.endISO,
    p_user_id: params.userId,
    p_department_id: params.departmentId,
    p_channel_id: params.channelId,
  })
  if (error) throw error

  const result = data as RpcResult
  const granularity = result.filters.granularity

  // Same gap-fill convention as loadTicketDashboard: the RPC only
  // emits a row per bucket with at least one judged ticket (see
  // get_sla_dashboard's migration header) — fill every other bucket
  // in the period with zero so the trend chart's lines don't look
  // like missing data instead of "nothing judged yet that day".
  const byBucket = new Map(result.charts.daily.map((d) => [d.date, d]))
  const daily: SlaDailyPoint[] = bucketKeysForPeriod(granularity, params.period, params.timezone).map((key) => {
    const bucket = byBucket.get(key)
    return {
      date: key,
      firstResponse: metric(bucket?.fr_total ?? 0, bucket?.fr_within ?? 0),
      resolution: metric(bucket?.res_total ?? 0, bucket?.res_within ?? 0),
    }
  })

  return {
    granularity,
    firstResponseGoalMinutes: result.filters.first_response_goal_minutes,
    firstResponseBusinessHours: result.filters.first_response_business_hours,
    resolutionGoalMinutes: result.filters.resolution_goal_minutes,
    resolutionBusinessHours: result.filters.resolution_business_hours,
    cards: {
      firstResponse: metric(result.cards.fr_total, result.cards.fr_within),
      resolution: metric(result.cards.res_total, result.cards.res_within),
    },
    daily,
    // Most violations first — an SLA ranking's job is to surface who
    // needs attention, not to flatter the best performer at the top
    // (contrast with NPS's agentRanking, which sorts best-first).
    agentRanking: result.agent_ranking
      .map((a) => ({
        userId: a.agent_id,
        firstResponse: metric(a.fr_total, a.fr_within),
        resolution: metric(a.res_total, a.res_within),
      }))
      .sort((a, b) => {
        const violationsOf = (r: typeof a) =>
          r.firstResponse.total - r.firstResponse.withinGoal + r.resolution.total - r.resolution.withinGoal
        return violationsOf(b) - violationsOf(a)
      }),
    atRisk: result.at_risk.map((r) => ({
      ticketId: r.ticket_id,
      conversationId: r.conversation_id,
      protocolNumber: r.protocol_number,
      contactName: r.contact_name,
      departmentName: r.department_name,
      agentId: r.agent_id,
      openedAt: r.opened_at,
      pctElapsed: r.pct_elapsed,
    })),
  }
}
