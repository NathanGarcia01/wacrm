// Timezone-aware date math shared by every period resolver that needs
// to anchor "today"/boundaries to a SPECIFIC timezone (the account's)
// rather than the viewer's browser clock. Extracted from
// ticket-dashboard-period.ts (Fase 3, Etapa 4) when the same math
// turned out to be needed again for the Pipelines board's period
// filter — see resolveAccountPeriod in period.ts.

export interface YMD {
  y: number
  m: number
  d: number
}

/** The UTC-ms equivalent of this instant's wall-clock date/time *as
 *  observed in* `timeZone` — e.g. for a UTC instant that reads as
 *  "2026-03-05 10:00" in `timeZone`, returns Date.UTC(2026,2,5,10,0,0). */
export function wallClockAsUtcMs(epochMs: number, timeZone: string): number {
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
export function zonedMidnightToUtcISO(ymd: YMD, timeZone: string): string {
  const target = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0)
  let t = target
  for (let i = 0; i < 2; i++) {
    const offset = wallClockAsUtcMs(t, timeZone) - t
    t = target - offset
  }
  return new Date(t).toISOString()
}

/** "Today" as a Y/M/D triple in `timeZone` — not the viewer's browser
 *  timezone, which is the whole point of this module. */
export function zonedToday(timeZone: string): YMD {
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

export function addDaysYMD(ymd: YMD, days: number): YMD {
  // UTC-anchored arithmetic on the calendar components only — no tz
  // conversion involved, so this can't be thrown off by DST.
  const d = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d))
  d.setUTCDate(d.getUTCDate() + days)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

/** Monday-first day-of-week index (0=Mon..6=Sun) for a Y/M/D triple,
 *  computed via UTC-anchored arithmetic so it never depends on which
 *  timezone the CALLER's JS Date object happens to carry. */
export function mondayIndexYMD(ymd: YMD): number {
  const jsDow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay() // 0..6, Sunday=0
  return (jsDow + 6) % 7
}

export function toDateKey(ymd: YMD): string {
  return `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`
}

export function parseDateKey(key: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}
