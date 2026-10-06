// Period resolution for the Dash de Atendimento (Fase 3, Etapa 4).
// Unlike the generic Reports period filter (period.ts, browser-local
// time), this tab's spec calls for boundaries in the ACCOUNT's
// configured timezone — get_ticket_dashboard() itself resolves
// `account.timezone` server-side for its `daily` bucketing, so the
// client's period boundaries need to agree with that same zone or
// "hoje" could clip/duplicate a few hours of tickets near midnight
// whenever the viewer's browser zone differs from the account's.

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

interface YMD {
  y: number
  m: number
  d: number
}

/** The UTC-ms equivalent of this instant's wall-clock date/time *as
 *  observed in* `timeZone` — e.g. for a UTC instant that reads as
 *  "2026-03-05 10:00" in `timeZone`, returns Date.UTC(2026,2,5,10,0,0). */
function wallClockAsUtcMs(epochMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts = dtf.formatToParts(new Date(epochMs))
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value
  return Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
}

/** Resolves a Y/M/D midnight expressed IN `timeZone` to the actual
 *  UTC instant it refers to. Two fixed-point iterations are enough —
 *  the tz offset only ever changes across a DST edge, and converges
 *  immediately outside of it. */
function zonedMidnightToUtcISO(ymd: YMD, timeZone: string): string {
  const target = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0)
  let t = target
  for (let i = 0; i < 2; i++) {
    const offset = wallClockAsUtcMs(t, timeZone) - t
    t = target - offset
  }
  return new Date(t).toISOString()
}

/** "Today" as a Y/M/D triple in the account's timezone. */
function accountToday(timeZone: string): YMD {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = dtf.formatToParts(new Date())
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) }
}

function addDays(ymd: YMD, days: number): YMD {
  // UTC-anchored arithmetic on the calendar components only — no tz
  // conversion involved, so this can't be thrown off by DST.
  const d = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d))
  d.setUTCDate(d.getUTCDate() + days)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

function toDateKey(ymd: YMD): string {
  return `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`
}

function parseDateKey(key: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
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
  const today = accountToday(timeZone)

  if (key === "7d" || key === "30d") {
    const span = key === "7d" ? 7 : 30
    const start = addDays(today, -(span - 1))
    const end = addDays(today, 1)
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
      const end = addDays(to, 1)
      return {
        key,
        startISO: zonedMidnightToUtcISO(from, timeZone),
        endISO: zonedMidnightToUtcISO(end, timeZone),
        fromDate: customFrom,
        toDate: customTo,
      }
    }
  }

  const end = addDays(today, 1)
  return {
    key: "today",
    startISO: zonedMidnightToUtcISO(today, timeZone),
    endISO: zonedMidnightToUtcISO(end, timeZone),
    fromDate: toDateKey(today),
    toDate: toDateKey(today),
  }
}
