// Shared bucket-key helpers for dashboards that group rows by
// account-tz hour/day (ticket-dashboard-queries.ts, sla-queries.ts).
// Both backing RPCs choose "hour" granularity when the resolved
// period spans <= 1 day, else "day" — these helpers must produce the
// exact same key format as each RPC's own `to_char(...)` bucketing,
// or the gap-fill below silently misses every real bucket.

export type DashboardGranularity = "hour" | "day"

/** YYYY-MM-DDTHH:00:00 for `epochMs` as observed in `timeZone`. */
export function hourKey(epochMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(epochMs))) if (p.type !== "literal") map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}T${map.hour}:00:00`
}

/** Inclusive list of YYYY-MM-DD keys from `fromDate` to `toDate` —
 *  string/UTC-anchored arithmetic only, deliberately independent of
 *  any timezone conversion (the RPCs' day buckets are already
 *  account-tz calendar dates by the time they reach us as date keys). */
export function dayKeysBetween(fromDate: string, toDate: string): string[] {
  const keys: string[] = []
  const [fy, fm, fd] = fromDate.split("-").map(Number)
  const cursor = new Date(Date.UTC(fy, fm - 1, fd))
  const end = new Date(`${toDate}T00:00:00Z`)
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

/** All bucket keys spanning a resolved period, matching `granularity`
 *  exactly — the full set a gap-fill should map over (present or not
 *  in the RPC's sparse response). */
export function bucketKeysForPeriod(
  granularity: DashboardGranularity,
  period: { startISO: string; endISO: string; fromDate: string; toDate: string },
  timeZone: string,
): string[] {
  if (granularity === "day") {
    return dayKeysBetween(period.fromDate, period.toDate)
  }
  const keys: string[] = []
  const start = new Date(period.startISO).getTime()
  const end = new Date(period.endISO).getTime()
  for (let t = start; t < end; t += 3_600_000) {
    keys.push(hourKey(t, timeZone))
  }
  return keys
}
