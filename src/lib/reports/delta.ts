export type Delta = { sign: number; arrowSign: number; label: string } | undefined

export interface DeltaLabels {
  /** e.g. "vs. período anterior" — appended after the formatted change. */
  vsPrevious: string
  /** Shown when the previous period was 0 and the current one isn't. */
  new: string
  /** Shown when both periods are 0 (or otherwise exactly equal). */
  flat: string
}

/** Relative % change, for metrics where "previous = 0" is a real
 *  baseline (counts, money) rather than a sentinel — dividing by zero
 *  would otherwise read as a nonsensical "+Infinity%".
 *
 *  `higherIsBetter` only flips the returned `sign` (green/red, via
 *  MetricCard's DeltaRow) — the arrow direction and the printed
 *  percentage always reflect the real, literal change. A response
 *  time that fell 11% should show "-11%" with a DOWN arrow either
 *  way; `higherIsBetter: false` is what makes that drop render green
 *  instead of red (faster is the win, not the loss). */
export function relativeDelta(
  current: number | null,
  previous: number | null,
  labels: DeltaLabels,
  higherIsBetter = true,
): Delta {
  if (current == null || previous == null) return undefined
  const flip = higherIsBetter ? 1 : -1
  if (previous === 0) {
    if (current === 0) return { sign: 0, arrowSign: 0, label: labels.flat }
    return { sign: flip, arrowSign: 1, label: labels.new }
  }
  const pct = ((current - previous) / previous) * 100
  const arrowSign = pct > 0 ? 1 : pct < 0 ? -1 : 0
  return {
    sign: arrowSign * flip,
    arrowSign,
    label: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% ${labels.vsPrevious}`,
  }
}

/** Point-difference change for metrics that are ALREADY a 0-100 rate
 *  — a relative "% of %" change reads as meaningless/alarmist (e.g.
 *  0%→5% isn't a "+∞%"), so this compares in percentage points instead.
 *  See `relativeDelta` for what `higherIsBetter` does. */
export function pointsDelta(
  current: number | null,
  previous: number | null,
  labels: DeltaLabels,
  higherIsBetter = true,
): Delta {
  if (current == null || previous == null) return undefined
  const flip = higherIsBetter ? 1 : -1
  const diff = current - previous
  const arrowSign = diff > 0 ? 1 : diff < 0 ? -1 : 0
  return {
    sign: arrowSign * flip,
    arrowSign,
    label: `${diff > 0 ? "+" : ""}${diff.toFixed(0)} p.p. ${labels.vsPrevious}`,
  }
}
