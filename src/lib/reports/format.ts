/** "—" when null, "Xmin" under an hour, "Xh Ymin" (or "Xh" flat) above. */
export function formatResponseTime(minutes: number | null): string {
  if (minutes == null) return "—"
  const total = Math.round(minutes)
  if (total < 60) return `${total}min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

/** Same rendering as formatResponseTime, for callers (get_ticket_dashboard's
 *  tma_seconds / first_response_seconds) whose source value is in seconds
 *  rather than minutes. */
export function formatDurationSeconds(seconds: number | null): string {
  return formatResponseTime(seconds == null ? null : seconds / 60)
}
