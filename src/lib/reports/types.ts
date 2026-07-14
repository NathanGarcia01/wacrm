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
  /** Sum of broadcasts.sent_count across the period. */
  totalSent: number
  /** Distinct contact_id across broadcast_recipients for broadcasts in
   *  the period (a contact reached by 2 broadcasts counts once) —
   *  "leads subidos", not a per-broadcast sum. */
  uniqueContactsReached: number
  /** replied / sent × 100, 0-100. Null when totalSent is 0. */
  replyRatePct: number | null
  /** Deals won whose contact received one of these broadcasts and the
   *  deal was created after it went out — same attribution rule as the
   *  ROI tab (src/lib/reports/broadcast-roi-queries.ts). */
  dealsWon: number
  /** Sum of deal_products.commission_value across dealsWon. */
  commissionGenerated: number
}

/** One quick-reply button's click count for a broadcast, ranked by
 *  popularity — "Button 1"/"Button 2" are the top-2 clicked labels for
 *  that specific broadcast, not a fixed template slot (different
 *  broadcasts can use different templates/button text). */
export interface BroadcastButtonStat {
  label: string
  count: number
  /** 0-100, of the broadcast's sentCount. */
  pct: number
}

export interface BroadcastReportRow {
  id: string
  name: string
  templateName: string
  createdAt: string
  sentCount: number
  repliedCount: number
  /** 0-100. Null when sentCount is 0. */
  replyRatePct: number | null
  /** Most-clicked button, if any. */
  button1: BroadcastButtonStat | null
  /** Second most-clicked button, if any. */
  button2: BroadcastButtonStat | null
  /** Repliers who never tapped a button (repliedCount minus everyone
   *  with a non-null button_clicked) — free-text replies. */
  freeTextCount: number
  /** 0-100. Null when sentCount is 0. */
  freeTextPct: number | null
  dealsWon: number
  commissionGenerated: number
}

export interface BroadcastReportFunnel {
  sent: number
  replied: number
  dealsCreated: number
  dealsWon: number
}

export interface BroadcastsReportBundle {
  cards: BroadcastReportCards
  broadcasts: BroadcastReportRow[]
  funnel: BroadcastReportFunnel
}

// ------------------------------------------------------------
// Broadcast ROI tab
// ------------------------------------------------------------

export interface BroadcastRoiCostBreakdown {
  marketing: number
  utility: number
  authentication: number
  total: number
}

export interface BroadcastRoiFunnel {
  sent: number
  replied: number
  dealsCreated: number
  dealsWon: number
}

export interface BroadcastRoiCards {
  cost: BroadcastRoiCostBreakdown
  /** Sum of deal_products.commission_value for won deals attributed to
   *  the broadcast(s) — NOT deal value. See loadBroadcastRoiReport's
   *  doc comment for the attribution rule. */
  commissionGenerated: number
  /** (commissionGenerated - cost.total) / cost.total × 100. Null when cost.total is 0. */
  roiPct: number | null
  /** commissionGenerated / cost.total, e.g. 4.2 → rendered as "4.2x". Null when cost.total is 0. */
  multiple: number | null
  /** Recipients who replied to the broadcast (broadcast_recipients.replied_at is set). */
  leadsGenerated: number
  /** Deals created (any status) for a contact reached by the broadcast, after it went out. */
  dealsCreated: number
  dealsWon: number
  /** dealsWon / leadsGenerated × 100. Null when leadsGenerated is 0. */
  conversionRatePct: number | null
  /** commissionGenerated / dealsWon. Null when dealsWon is 0. */
  avgCommissionPerDeal: number | null
  /** Average won_at - broadcast.created_at, in days. Null when dealsWon is 0. */
  avgDaysToClose: number | null
}

export interface BroadcastRoiRow {
  id: string
  name: string
  templateCategory: string | null
  sentCount: number
  cost: number
  dealsWon: number
  commissionGenerated: number
  /** (commissionGenerated - cost) / cost × 100. Null when cost is 0. */
  roiPct: number | null
}

export interface BroadcastRoiBundle {
  cards: BroadcastRoiCards
  rows: BroadcastRoiRow[]
  funnel: BroadcastRoiFunnel
}

export interface BroadcastRoiDealRow {
  id: string
  dealTitle: string
  contactName: string | null
  value: number
  commission: number
  closedAt: string | null
}

export interface BroadcastRoiDetail {
  cards: BroadcastRoiCards
  funnel: BroadcastRoiFunnel
  deals: BroadcastRoiDealRow[]
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
