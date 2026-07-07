// Shared result shapes for the Reports page. Mirrors
// src/lib/dashboard/types.ts's role for the dashboard.

export type PeriodKey = "today" | "week" | "month" | "custom"

export interface PeriodRange {
  key: PeriodKey
  /** Inclusive local start-of-range, ISO timestamp. */
  startISO: string
  /** Exclusive local end-of-range, ISO timestamp. */
  endISO: string
  /** YYYY-MM-DD — drives the custom-range date inputs + URL params. */
  fromDate: string
  toDate: string
}

export interface AccountReportCards {
  messagesSent: number
  messagesReceived: number
  conversationsHandled: number
  dealsWon: number
  valueWon: number
  /** Null when there are no customer→agent reply pairs in the period. */
  avgResponseMinutes: number | null
  /**
   * % of conversations contacted by an agent in the period where the
   * customer replied afterward — 0-100, null when no conversation was
   * contacted by an agent in the period.
   */
  responseRatePct: number | null
}

/** One point per calendar day in the period, local-day keyed (YYYY-MM-DD). */
export interface MessagesPerDayPoint {
  date: string
  sent: number
  received: number
}

export interface UserReportRow {
  /** profiles.user_id — matches conversations.assigned_agent_id. */
  userId: string
  /** profiles.id — matches deals.assigned_to. */
  profileId: string
  name: string
  email: string
  messagesSent: number
  conversationsHandled: number
  dealsWon: number
  valueWon: number
}

export interface ReportsBundle {
  cards: AccountReportCards
  users: UserReportRow[]
  messagesPerDay: MessagesPerDayPoint[]
}

// ------------------------------------------------------------
// Pipeline & Sales tab
// ------------------------------------------------------------

export interface PipelineReportCards {
  dealsCreated: number
  dealsWon: number
  dealsLost: number
  /** 0-100. Null when there are no won+lost deals in the period. */
  conversionRatePct: number | null
  valueWon: number
  /** Null when there are no won deals in the period. */
  avgTicket: number | null
  /** Average won_at - created_at, in days. Null when there are no won deals. */
  avgCloseDays: number | null
  /** Sum of deal_products.commission_value across deals won in the period. */
  commissionWon: number
  /** Sum of deal_products.commission_value across all currently open
   *  deals — not period-scoped, mirrors the funnel's "pipeline right
   *  now" semantics. */
  commissionProjected: number
}

/** Commission earned per agent from deals won in the period, ranked
 *  by commissionWon descending. */
export interface CommissionAgentRow {
  profileId: string
  name: string
  commissionWon: number
  dealsWon: number
}

export interface PipelineFunnelStage {
  stageId: string
  name: string
  color: string
  position: number
  count: number
}

export interface DealsPerDayPoint {
  date: string
  won: number
}

export interface DealReportRow {
  id: string
  title: string
  contactName: string | null
  value: number
  currency: string
  stageName: string | null
  stageColor: string | null
  assigneeName: string | null
  createdAt: string
  closedAt: string | null
  status: string
}

export interface PipelineReportBundle {
  cards: PipelineReportCards
  funnel: PipelineFunnelStage[]
  dealsPerDay: DealsPerDayPoint[]
  deals: DealReportRow[]
  commissionByAgent: CommissionAgentRow[]
}

// ------------------------------------------------------------
// Commissions tab
// ------------------------------------------------------------

export type CommissionStatusFilter = "all" | "open" | "won" | "lost"

export interface CommissionReportCards {
  /** Commission from deals won in the period. */
  commissionWon: number
  /** Commission sitting in currently open deals — mirrors the Pipeline
   *  tab's "Comissão prevista": a snapshot of the live pipeline, not
   *  period-scoped (an open deal has no close date to scope by). */
  commissionOpen: number
  /** Commission that would have been earned on deals lost in the period. */
  commissionLost: number
}

/** One row per deal_products line item, joined up to its deal/contact/agent. */
export interface CommissionRow {
  dealId: string
  dealTitle: string
  contactName: string | null
  productName: string
  value: number
  quantity: number
  commissionRate: number | null
  commissionValue: number
  agentName: string | null
  status: string
  /** won_at / lost_at / created_at, whichever applies to the deal's status. */
  date: string
  currency: string
}

export interface CommissionByMonthPoint {
  /** YYYY-MM */
  month: string
  commission: number
}

export interface CommissionReportBundle {
  cards: CommissionReportCards
  rows: CommissionRow[]
  byMonth: CommissionByMonthPoint[]
  agentRanking: CommissionAgentRow[]
  stages: { id: string; name: string }[]
}

// ------------------------------------------------------------
// Broadcasts tab
// ------------------------------------------------------------

export interface BroadcastReportCards {
  totalBroadcasts: number
  uniqueRecipients: number
  delivered: number
  failed: number
  /** 0-100. Null when there are no recipients in the period. */
  deliveryRatePct: number | null
  /** 0-100. Null when there are no delivered/read/sent recipients. */
  replyRatePct: number | null
}

export interface BroadcastReportRow {
  id: string
  name: string
  templateName: string
  createdAt: string
  totalRecipients: number
  deliveredCount: number
  failedCount: number
  repliedCount: number
  /** 0-100. Null when totalRecipients is 0. */
  replyRatePct: number | null
}

export interface BroadcastsReportBundle {
  cards: BroadcastReportCards
  broadcasts: BroadcastReportRow[]
}

// ------------------------------------------------------------
// Meta account quality tab
// ------------------------------------------------------------

export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

export interface AccountQualityInfo {
  qualityRating: QualityRating
  messagingLimitTier: string | null
  displayPhoneNumber: string | null
  checkedAt: string
}

// ------------------------------------------------------------
// Satisfaction (NPS) tab
// ------------------------------------------------------------

export interface NpsReportCards {
  /** Average of all surveys with a rating in the period. Null if none. */
  avgRating: number | null
  totalSent: number
  /** Surveys that got at least a rating (comment is optional). */
  totalResponded: number
  /** 0-100. Null when totalSent is 0. */
  responseRatePct: number | null
}

export interface NpsRatingDistributionPoint {
  rating: 1 | 2 | 3 | 4 | 5
  count: number
}

export interface NpsReviewRow {
  id: string
  contactName: string | null
  rating: number | null
  comment: string | null
  agentName: string | null
  sentAt: string
  respondedAt: string | null
}

export interface NpsAgentRankingRow {
  userId: string
  name: string
  avgRating: number | null
  totalResponses: number
}

/** One point per calendar day in the period, local-day keyed. */
export interface NpsTrendPoint {
  date: string
  avgRating: number | null
}

export interface NpsReportBundle {
  cards: NpsReportCards
  distribution: NpsRatingDistributionPoint[]
  reviews: NpsReviewRow[]
  agentRanking: NpsAgentRankingRow[]
  trend: NpsTrendPoint[]
}
