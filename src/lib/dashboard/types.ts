// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface NpsSummary {
  /** Average of rated surveys sent within the selected period. Null if none. */
  avgRating: number | null
  /** Surveys that got at least a rating within the period. */
  totalResponses: number
  /** 0-100, responded ÷ sent. Null when none were sent in the period. */
  responseRatePct: number | null
}

export interface MetricsBundle {
  /** Live snapshot — always "right now", unaffected by the period filter. */
  activeConversations: MetricDelta
  /** Contacts created within the selected period, vs the immediately
   *  preceding period of equal length. */
  newContacts: MetricDelta
  /** Live snapshot — always "right now", unaffected by the period filter. */
  openDealsValue: number
  openDealsCount: number
  /** Agent-sent messages within the selected period, vs the immediately
   *  preceding period of equal length. */
  messagesSent: MetricDelta
  nps: NpsSummary
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  currentPeriodAvg: number | null
  previousPeriodAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}
