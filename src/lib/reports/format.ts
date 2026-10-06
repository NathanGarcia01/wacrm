import type { SlaMetricCounts } from './types'

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

/** "—" when nothing's been judged yet (including an unconfigured
 *  goal — get_sla_dashboard never emits a judged row without one),
 *  never a misleading 0%. */
export function formatSlaCompliancePct(m: SlaMetricCounts): string {
  return m.total === 0 ? "—" : `${((m.withinGoal / m.total) * 100).toFixed(0)}%`
}

/** Same "—" convention as formatSlaCompliancePct — 0 judged tickets
 *  means "not measured", not "zero violations". */
export function formatSlaViolations(m: SlaMetricCounts): string {
  return m.total === 0 ? "—" : (m.total - m.withinGoal).toLocaleString()
}
