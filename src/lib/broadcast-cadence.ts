/**
 * Anti-ban cadence defaults + business-hours math shared between the
 * Send step (client-side estimate) and the cron worker (actual gating).
 */

export const BATCH_SIZE_DEFAULT = 50
export const BATCH_SIZE_MIN = 10
export const BATCH_SIZE_MAX = 200

export const BATCH_INTERVAL_MINUTES_DEFAULT = 10
export const BATCH_INTERVAL_MINUTES_MIN = 2
export const BATCH_INTERVAL_MINUTES_MAX = 60

export const MESSAGE_DELAY_MIN_SECONDS_DEFAULT = 3
export const MESSAGE_DELAY_MAX_SECONDS_DEFAULT = 8

export const BUSINESS_HOURS_TIMEZONE = 'America/Sao_Paulo'
export const BUSINESS_HOURS_START = 8
export const BUSINESS_HOURS_END = 20

export interface CadenceSettings {
  batchSize: number
  batchIntervalMinutes: number
  messageDelayMinSeconds: number
  messageDelayMaxSeconds: number
  respectBusinessHours: boolean
}

export const DEFAULT_CADENCE: CadenceSettings = {
  batchSize: BATCH_SIZE_DEFAULT,
  batchIntervalMinutes: BATCH_INTERVAL_MINUTES_DEFAULT,
  messageDelayMinSeconds: MESSAGE_DELAY_MIN_SECONDS_DEFAULT,
  messageDelayMaxSeconds: MESSAGE_DELAY_MAX_SECONDS_DEFAULT,
  respectBusinessHours: true,
}

/** Hour-of-day (0-23) in America/Sao_Paulo for a given instant. */
function brtHour(date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_HOURS_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(date)
  // Intl can format midnight as "24" depending on runtime — normalize.
  return Number(formatted) % 24
}

export function isWithinBusinessHours(date: Date): boolean {
  const hour = brtHour(date)
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END
}

/**
 * Next instant (as a UTC `Date`) at which BUSINESS_HOURS_START occurs in
 * America/Sao_Paulo, relative to `date`. Used to snap a paused broadcast's
 * `next_batch_at` forward when a batch would otherwise land outside the
 * allowed window — "resumes at 08:00 the next day" per spec, or later
 * today if `date` is still before 08:00 BRT.
 */
export function nextBusinessHoursStart(date: Date): Date {
  const hour = brtHour(date)
  // Days to add: already past today's window (>= END) → tomorrow.
  // Before today's window (< START) → later today (0 days).
  const daysToAdd = hour >= BUSINESS_HOURS_END ? 1 : 0

  // Build the target by re-formatting `date` into BRT y/m/d parts, then
  // constructing a fixed-offset ISO string. America/Sao_Paulo has been a
  // flat UTC-3 with no DST since the 2019 abolition, so this offset is
  // safe to hardcode rather than pulling in a tz-database dependency.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_HOURS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  const d = parts.find((p) => p.type === 'day')!.value

  const startHour = String(BUSINESS_HOURS_START).padStart(2, '0')
  const target = new Date(`${y}-${m}-${d}T${startHour}:00:00-03:00`)
  target.setUTCDate(target.getUTCDate() + daysToAdd)
  return target
}

export interface CadenceEstimate {
  totalBatches: number
  /** Seconds, inclusive of inter-message delay + inter-batch pauses. Ignores business-hours pauses. */
  lowSeconds: number
  highSeconds: number
}

/**
 * Rough send-time estimate for the Step 4 summary card. Deliberately
 * ignores business-hours pauses (unknowable without simulating real
 * wall-clock time) — the UI labels this as approximate.
 */
export function estimateCadence(
  totalRecipients: number,
  cadence: CadenceSettings,
): CadenceEstimate {
  if (totalRecipients <= 0) {
    return { totalBatches: 0, lowSeconds: 0, highSeconds: 0 }
  }
  const totalBatches = Math.ceil(totalRecipients / cadence.batchSize)
  const pauseSeconds = Math.max(0, totalBatches - 1) * cadence.batchIntervalMinutes * 60

  const lowSeconds = totalRecipients * cadence.messageDelayMinSeconds + pauseSeconds
  const highSeconds = totalRecipients * cadence.messageDelayMaxSeconds + pauseSeconds

  return { totalBatches, lowSeconds, highSeconds }
}
