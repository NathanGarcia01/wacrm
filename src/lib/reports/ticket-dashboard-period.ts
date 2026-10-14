// Period resolution for the Dash de Atendimento (Fase 3, Etapa 4).
// Unlike the generic Reports period filter (period.ts, browser-local
// time), this tab's spec calls for boundaries in the ACCOUNT's
// configured timezone — get_ticket_dashboard() itself resolves
// `account.timezone` server-side for its `daily` bucketing, so the
// client's period boundaries need to agree with that same zone or
// "hoje" could clip/duplicate a few hours of tickets near midnight
// whenever the viewer's browser zone differs from the account's.
//
// The Y/M/D + timezone math below moved to timezone.ts — the
// Pipelines board's period filter (resolveAccountPeriod in period.ts)
// needed the exact same "today, in THIS timezone" primitives.

import { addDaysYMD, parseDateKey, toDateKey, zonedMidnightToUtcISO, zonedToday } from "./timezone"

export type TicketDashboardPeriodKey = "today" | "7d" | "30d" | "custom"

export function isTicketDashboardPeriodKey(v: string | null): v is TicketDashboardPeriodKey {
  return v === "today" || v === "7d" || v === "30d" || v === "custom"
}

export interface TicketDashboardPeriodRange {
  key: TicketDashboardPeriodKey
  /** Inclusive start, ISO timestamp (UTC instant). */
  startISO: string
  /** Exclusive end, ISO timestamp (UTC instant). */
  endISO: string
  /** YYYY-MM-DD in the account's timezone — drives the custom-range
   *  date inputs + URL params. */
  fromDate: string
  toDate: string
}

/**
 * Resolves a period key (+ optional custom bounds) into concrete
 * start/end UTC instants, all anchored to the account's timezone:
 *   - today:  00:00 today (account tz)        → 00:00 tomorrow
 *   - 7d:     00:00 6 days ago (account tz)    → 00:00 tomorrow
 *   - 30d:    00:00 29 days ago (account tz)   → 00:00 tomorrow
 *   - custom: 00:00 `from`                     → 00:00 (`to` + 1 day)
 * Falls back to "today" for an unrecognised key or a malformed/
 * incomplete custom range.
 */
export function resolveTicketDashboardPeriod(
  key: TicketDashboardPeriodKey,
  timeZone: string,
  customFrom?: string | null,
  customTo?: string | null,
): TicketDashboardPeriodRange {
  const today = zonedToday(timeZone)

  if (key === "7d" || key === "30d") {
    const span = key === "7d" ? 7 : 30
    const start = addDaysYMD(today, -(span - 1))
    const end = addDaysYMD(today, 1)
    return {
      key,
      startISO: zonedMidnightToUtcISO(start, timeZone),
      endISO: zonedMidnightToUtcISO(end, timeZone),
      fromDate: toDateKey(start),
      toDate: toDateKey(today),
    }
  }

  if (key === "custom" && customFrom && customTo) {
    const from = parseDateKey(customFrom)
    const to = parseDateKey(customTo)
    if (from && to) {
      const end = addDaysYMD(to, 1)
      return {
        key,
        startISO: zonedMidnightToUtcISO(from, timeZone),
        endISO: zonedMidnightToUtcISO(end, timeZone),
        fromDate: customFrom,
        toDate: customTo,
      }
    }
  }

  const end = addDaysYMD(today, 1)
  return {
    key: "today",
    startISO: zonedMidnightToUtcISO(today, timeZone),
    endISO: zonedMidnightToUtcISO(end, timeZone),
    fromDate: toDateKey(today),
    toDate: toDateKey(today),
  }
}
