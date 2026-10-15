export type Delta = {
  sign: number
  arrowSign: number
  label: string
  /** Same change, without the trailing "vs X" phrase — shown instead
   *  of `label` on narrow screens so the delta row stays on one line
   *  inside a 2-column mobile KPI card. Falls back to `label` when
   *  absent. */
  shortLabel?: string
} | undefined

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

/**
 * Same as `relativeDelta`, but falls back to an absolute-value label
 * (via `formatAbsolute`) instead of a percentage whenever the % would
 * be misleading: the previous period's `gateCount` (an independent
 * volume metric — e.g. deals won — not necessarily `previous` itself)
 * is below 5, or the relative change exceeds 300%. A jump from 1 to 8
 * deals is technically "+700%", but the number that actually means
 * something there is "+7 negócios", not the percentage.
 *
 * Always attaches `shortLabel` (the value with no " vs X" suffix) for
 * single-line mobile display — unlike `relativeDelta`/`pointsDelta`,
 * which stay label-only so their existing tests/callers don't change.
 */
export function gatedRelativeDelta(
  current: number | null,
  previous: number | null,
  gateCount: number,
  labels: DeltaLabels,
  formatAbsolute: (current: number, previous: number) => string,
  higherIsBetter = true,
  /** Mobile-only variant of the absolute value — e.g. "+R$ 48.084"
   *  instead of "R$ 4.170 → R$ 52.254", which gets clipped in a
   *  narrow 2-column KPI card. Falls back to `formatAbsolute` when
   *  omitted (already-short formats, like a deal count, don't need a
   *  separate one). */
  formatAbsoluteShort?: (current: number, previous: number) => string,
): Delta {
  if (current == null || previous == null) return undefined
  const base = relativeDelta(current, previous, labels, higherIsBetter)
  if (!base) return base
  if (previous === 0) return { ...base, shortLabel: base.label }

  const pct = ((current - previous) / previous) * 100
  if (gateCount >= 5 && Math.abs(pct) <= 300) {
    return { ...base, shortLabel: base.label.replace(` ${labels.vsPrevious}`, "") }
  }

  const absoluteValue = formatAbsolute(current, previous)
  const shortValue = (formatAbsoluteShort ?? formatAbsolute)(current, previous)
  return { ...base, label: `${absoluteValue} ${labels.vsPrevious}`, shortLabel: shortValue }
}

/** Attaches a mobile `shortLabel` (the value with no " vs X" suffix)
 *  to a Delta already produced by `relativeDelta`/`pointsDelta` —
 *  used where the gating logic of `gatedRelativeDelta` doesn't apply
 *  (e.g. a points-based metric) but the same single-line mobile
 *  treatment is still wanted. */
export function withShortLabel(delta: Delta, vsPrevious: string): Delta {
  if (!delta) return delta
  const suffix = ` ${vsPrevious}`
  return { ...delta, shortLabel: delta.label.endsWith(suffix) ? delta.label.slice(0, -suffix.length) : delta.label }
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
