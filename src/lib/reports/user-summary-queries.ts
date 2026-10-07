import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserSummaryBundle, UserSummaryRow } from './types'
import type { TicketDashboardPeriodRange } from './ticket-dashboard-period'

type DB = SupabaseClient

interface RpcRow {
  agent_id: string | null
  received: number
  closed: number
  in_progress: number
  tma_mean_seconds: number | null
  tma_median_seconds: number | null
  first_response_mean_seconds: number | null
  first_response_median_seconds: number | null
  sla_fr_total: number
  sla_fr_within: number
  sla_res_total: number
  sla_res_within: number
  messages_sent: number
  transfers_made: number
  transfers_received: number
  nps_avg_rating: number | null
  deals_won: number
  deals_won_value: number
  sales_goal_value: number | null
  sales_goal_count: number | null
  sales_actual_value_month: number
  sales_actual_count_month: number
}

interface RpcResult {
  filters: {
    first_response_goal_minutes: number | null
    resolution_goal_minutes: number | null
    sales_goal_month: string
  }
  rows: RpcRow[]
}

export async function loadUserSummaryDashboard(
  db: DB,
  params: {
    accountId: string
    period: TicketDashboardPeriodRange
    departmentId: string | null
    channelId: string | null
    businessHours: boolean
  },
): Promise<UserSummaryBundle> {
  const { data, error } = await db.rpc('get_user_summary_dashboard', {
    p_account_id: params.accountId,
    p_start: params.period.startISO,
    p_end: params.period.endISO,
    p_department_id: params.departmentId,
    p_channel_id: params.channelId,
    p_business_hours: params.businessHours,
  })
  if (error) throw error

  const result = data as RpcResult

  const rows: UserSummaryRow[] = result.rows.map((r) => ({
    userId: r.agent_id,
    receivedCount: r.received,
    closedCount: r.closed,
    inProgressCount: r.in_progress,
    tma: { meanSeconds: r.tma_mean_seconds, medianSeconds: r.tma_median_seconds },
    firstResponse: { meanSeconds: r.first_response_mean_seconds, medianSeconds: r.first_response_median_seconds },
    sla: {
      firstResponse: { total: r.sla_fr_total, withinGoal: r.sla_fr_within },
      resolution: { total: r.sla_res_total, withinGoal: r.sla_res_within },
    },
    messagesSent: r.messages_sent,
    transfersMade: r.transfers_made,
    transfersReceived: r.transfers_received,
    npsAvgRating: r.nps_avg_rating,
    dealsWonCount: r.deals_won,
    dealsWonValue: r.deals_won_value,
    salesGoalValue: r.sales_goal_value,
    salesGoalCount: r.sales_goal_count,
    salesActualValueMonth: r.sales_actual_value_month,
    salesActualCountMonth: r.sales_actual_count_month,
  }))

  return {
    firstResponseGoalMinutes: result.filters.first_response_goal_minutes,
    resolutionGoalMinutes: result.filters.resolution_goal_minutes,
    salesGoalMonth: result.filters.sales_goal_month,
    rows,
  }
}
