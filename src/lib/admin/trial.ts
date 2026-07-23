/**
 * Whole days remaining until `trialEnd`, or null when there's no
 * trial end date at all (not on a trial, or trial data missing).
 * Can be 0 or negative once a trial has lapsed but the subscription
 * hasn't transitioned status yet — callers treat anything <= 3 as
 * urgent, not just the positive range.
 *
 * Shared by the accounts table column, the dashboard's trial KPI
 * tile, and the trials-expiring-soon alert card so "how many days
 * left" is computed exactly one way everywhere.
 */
export function trialDaysRemaining(trialEnd: string | null): number | null {
  if (!trialEnd) return null
  const diffMs = new Date(trialEnd).getTime() - Date.now()
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}
