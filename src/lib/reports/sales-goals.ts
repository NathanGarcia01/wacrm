/** YYYY-MM-01 for "now" as observed in `timezone` — must match
 *  get_pipeline_dashboard()/get_user_summary_dashboard()'s own
 *  `date_trunc('month', now() at time zone v_tz)` exactly, since this
 *  is also the key Settings reads/writes into `account_user_sales_goals`.
 *  Account timezone, not the browser's — a goal month shouldn't flip
 *  over at a different instant depending on who's looking. */
export function accountCurrentMonthKey(timezone: string, now: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit" })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(now)) if (p.type !== "literal") map[p.type] = p.value
  return `${map.year}-${map.month}-01`
}

/** The calendar month immediately before `monthKey` (also YYYY-MM-01) —
 *  used by the "copiar metas do mês anterior" action. String arithmetic
 *  only, no timezone involved (the key is already a plain calendar month). */
export function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1))
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`
}
