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

// ------------------------------------------------------------
// Atendimento tab (Dash de Atendimento — get_ticket_dashboard())
// ------------------------------------------------------------

export interface TicketDashboardCards {
  totalTickets: number
  initiatedByCustomer: number
  initiatedByCompany: number
  /** Current open queue — NOT period-scoped, mirrors the RPC's
   *  current_status_tickets (a live count, not a historical cut). */
  pending: number
  inProgress: number
  agentsCount: number
  contactsServed: number
  /** Every contact created in the period, including bulk imports for
   *  a broadcast send that never replied — shown only inside the
   *  "Novos contatos que conversaram" tooltip, not as its own card
   *  (see newContactsEngaged). */
  newContacts: number
  /** Contacts created in the period who also sent at least one
   *  message in the period — the card value for "Novos contatos que
   *  conversaram". */
  newContactsEngaged: number
  /** Seconds. Null when there were no agent-closed, non-backfill
   *  tickets in the period. */
  tmaSeconds: number | null
  /** Seconds. Null when no customer-initiated ticket in the period
   *  got a first response (or all were backfilled). */
  firstResponseSeconds: number | null
}

export interface TicketsByChannelPoint {
  channelId: string | null
  channelName: string | null
  count: number
}

/** `tickets.source` — 'inbound' | 'manual_outbound' | 'campaign' | 'automation'. */
export interface TicketsBySourcePoint {
  source: string
  count: number
}

export interface TicketsByClosingReasonPoint {
  closingReasonId: string | null
  label: string | null
  count: number
}

export interface TicketsByDepartmentPoint {
  departmentId: string | null
  name: string | null
  count: number
}

/** One point per bucket in the period, account-tz keyed — YYYY-MM-DD
 *  when `granularity` is "day", YYYY-MM-DDTHH:00:00 when "hour". */
export interface TicketsPerDayPoint {
  date: string
  count: number
}

export interface TicketDashboardBundle {
  /** False when the account has no business_hours rows at all — drives
   *  the "horário de atendimento não configurado" warning when the
   *  business-hours toggle is on. */
  businessHoursConfigured: boolean
  /** "hour" when the resolved period spans <= 1 day (e.g. "hoje"),
   *  "day" otherwise — drives how TicketsPerDayChart buckets/labels
   *  charts.daily. */
  granularity: "hour" | "day"
  cards: TicketDashboardCards
  charts: {
    byChannel: TicketsByChannelPoint[]
    bySource: TicketsBySourcePoint[]
    byClosingReason: TicketsByClosingReasonPoint[]
    byDepartment: TicketsByDepartmentPoint[]
    daily: TicketsPerDayPoint[]
  }
}

export interface TicketDashboardFilterOptions {
  agents: { userId: string; name: string }[]
  departments: { id: string; name: string }[]
  channels: { id: string; name: string }[]
}

// ------------------------------------------------------------
// SLA tab (get_sla_dashboard())
// ------------------------------------------------------------

/**
 * Both SLA metrics share this shape: `total` only counts tickets
 * that can already be JUDGED — a real first-response/closure
 * (met or missed) OR still unresolved/open but already past the
 * goal (an immediate violation). An unresolved ticket still inside
 * the goal window isn't in `total` yet — see get_sla_dashboard's
 * migration header for the full rule. `withinGoal`/`total` is the
 * compliance % (null when total is 0); `total - withinGoal` is the
 * violation count.
 */
export interface SlaMetricCounts {
  total: number
  withinGoal: number
}

export interface SlaDashboardCards {
  firstResponse: SlaMetricCounts
  resolution: SlaMetricCounts
}

/** One point per bucket (see TicketsPerDayPoint's doc — same
 *  hour/day granularity rule), both metrics so the trend chart can
 *  plot both lines from a single array. */
export interface SlaDailyPoint {
  date: string
  firstResponse: SlaMetricCounts
  resolution: SlaMetricCounts
}

export interface SlaAgentRankingRow {
  /** Null → "Sem atendente" (unassigned tickets), rendered client-side. */
  userId: string | null
  firstResponse: SlaMetricCounts
  resolution: SlaMetricCounts
}

/** A ticket >= 80% through its first-response goal with no response
 *  yet — live, not period-scoped (see get_sla_dashboard's at_risk
 *  CTE). `pctElapsed` can exceed 100 (already breached, still open). */
export interface AtRiskTicketRow {
  ticketId: string
  conversationId: string
  protocolNumber: number
  contactName: string | null
  departmentName: string | null
  agentId: string | null
  openedAt: string
  pctElapsed: number
}

export interface SlaDashboardBundle {
  granularity: "hour" | "day"
  /** Null when the account hasn't set that goal — the UI shows "—"
   *  with a link to Configurações → Atendimento, never a fake 0%. */
  firstResponseGoalMinutes: number | null
  firstResponseBusinessHours: boolean
  resolutionGoalMinutes: number | null
  resolutionBusinessHours: boolean
  cards: SlaDashboardCards
  daily: SlaDailyPoint[]
  agentRanking: SlaAgentRankingRow[]
  atRisk: AtRiskTicketRow[]
}

// ------------------------------------------------------------
// Resumo por usuário (get_user_summary_dashboard())
// ------------------------------------------------------------

/** Mean/median pair, in seconds. Both null when the agent has no
 *  judged tickets for that metric in the period — never a fake 0s. */
export interface MeanMedianSeconds {
  meanSeconds: number | null
  medianSeconds: number | null
}

export interface UserSummaryRow {
  /** Null → "Sem atendente", rendered client-side. */
  userId: string | null
  receivedCount: number
  closedCount: number
  /** Live — tickets currently in_progress assigned to this agent,
   *  not scoped to the selected period. */
  inProgressCount: number
  tma: MeanMedianSeconds
  firstResponse: MeanMedianSeconds
  /** Same SlaMetricCounts shape as the SLA tab — total 0 means "not
   *  judged yet" (including when the account has no goal set), not
   *  "0% compliance". */
  sla: {
    firstResponse: SlaMetricCounts
    resolution: SlaMetricCounts
  }
  /** Best-effort — attributed via whichever ticket was open at the
   *  message's timestamp, since `messages` has no reliable sender-
   *  user column. Messages from before the ticket rollout (or any
   *  gap with no open ticket) aren't attributed to anyone and are
   *  excluded, not guessed. */
  messagesSent: number
  /** Transfers this agent executed (ticket_events.actor_id), not
   *  tickets that left their queue. */
  transfersMade: number
  /** Transfers that landed on this agent (ticket_events.to_agent_id). */
  transfersReceived: number
  /** Null when this agent has no rated NPS surveys in the period. */
  npsAvgRating: number | null
  dealsWonCount: number
  dealsWonValue: number
}

export interface UserSummaryBundle {
  firstResponseGoalMinutes: number | null
  resolutionGoalMinutes: number | null
  rows: UserSummaryRow[]
}
