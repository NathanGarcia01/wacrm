// Period resolution for the Reports page. Boundaries are computed in
// the user's LOCAL timezone (same convention as
// src/lib/dashboard/date-utils.ts) — "today" means the visitor's
// calendar day, not UTC's.

import { mondayIndex, startOfLocalDay } from "@/lib/dashboard/date-utils"
import type { PeriodKey, PeriodRange } from "./types"

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Parses a YYYY-MM-DD key as a local-midnight Date (not UTC). */
function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d))
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

/**
 * Resolves a period key (+ optional custom bounds) into concrete
 * start/end timestamps:
 *   - today:  00:00 today   → 00:00 tomorrow
 *   - week:   00:00 Monday  → 00:00 tomorrow
 *   - month:  00:00 day 1   → 00:00 tomorrow
 *   - custom: 00:00 `from`  → 00:00 (`to` + 1 day)
 * Falls back to "today" for an unrecognised key or a malformed/
 * incomplete custom range.
 */
export function resolvePeriod(
  key: PeriodKey,
  customFrom?: string | null,
  customTo?: string | null,
): PeriodRange {
  const today = startOfLocalDay()

  if (key === "week") {
    const start = addDays(today, -mondayIndex(today))
    const end = addDays(today, 1)
    return {
      key,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      fromDate: toDateKey(start),
      toDate: toDateKey(today),
    }
  }

  if (key === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end = addDays(today, 1)
    return {
      key,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      fromDate: toDateKey(start),
      toDate: toDateKey(today),
    }
  }

  if (key === "custom" && customFrom && customTo) {
    const fromDate = parseDateKey(customFrom)
    const toDate = parseDateKey(customTo)
    if (fromDate && toDate) {
      const start = startOfLocalDay(fromDate)
      const end = addDays(startOfLocalDay(toDate), 1)
      return {
        key,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        fromDate: customFrom,
        toDate: customTo,
      }
    }
  }

  const end = addDays(today, 1)
  return {
    key: "today",
    startISO: today.toISOString(),
    endISO: end.toISOString(),
    fromDate: toDateKey(today),
    toDate: toDateKey(today),
  }
}
