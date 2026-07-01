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
  conversationsHandled: number
  dealsWon: number
  valueWon: number
  /** Null when there are no customer→agent reply pairs in the period. */
  avgResponseMinutes: number | null
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
}
