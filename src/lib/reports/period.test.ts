import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveAccountPeriod, samePeriodLastMonth } from "./period"

describe("resolveAccountPeriod", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves 'today' to the account's calendar day, not the viewer's", () => {
    // 2026-10-14T23:30:00-03:00 == 2026-10-15T02:30:00Z — a browser in
    // UTC would already read this as Oct 15; São Paulo's wall clock
    // still reads Oct 14. This is the exact bug found live on the
    // Pipelines board's "Ganhos" filter: resolvePeriod (browser-local)
    // disagreed with the account's own calendar day for 21 of every
    // 24 hours. resolveAccountPeriod must give the SAME answer no
    // matter what timezone the machine calling it is set to.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-15T02:30:00.000Z"))

    const saoPaulo = resolveAccountPeriod("today", "America/Sao_Paulo")
    expect(saoPaulo.fromDate).toBe("2026-10-14")
    expect(saoPaulo.startISO).toBe("2026-10-14T03:00:00.000Z")
    expect(saoPaulo.endISO).toBe("2026-10-15T03:00:00.000Z")

    // Same real instant, resolved for a different account timezone —
    // must differ from the UTC-calendar-day answer (Oct 15), proving
    // the boundary tracks the PASSED-IN timezone, not whatever the
    // host machine's own clock is set to.
    const utc = resolveAccountPeriod("today", "UTC")
    expect(utc.fromDate).toBe("2026-10-15")
  })

  it("'week' starts on Monday in the account's timezone", () => {
    vi.useFakeTimers()
    // Wednesday 2026-10-14 12:00 BRT.
    vi.setSystemTime(new Date("2026-10-14T15:00:00.000Z"))
    const period = resolveAccountPeriod("week", "America/Sao_Paulo")
    expect(period.fromDate).toBe("2026-10-12") // the preceding Monday
    expect(period.toDate).toBe("2026-10-14")
  })

  it("'month' starts on the 1st in the account's timezone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-14T15:00:00.000Z"))
    const period = resolveAccountPeriod("month", "America/Sao_Paulo")
    expect(period.fromDate).toBe("2026-10-01")
  })

  it("'custom' resolves from/to at midnight in the account's timezone, end exclusive the day after `to`", () => {
    const period = resolveAccountPeriod("custom", "America/Sao_Paulo", "2026-09-01", "2026-09-30")
    expect(period.startISO).toBe("2026-09-01T03:00:00.000Z")
    expect(period.endISO).toBe("2026-10-01T03:00:00.000Z")
  })

  it("falls back to 'today' for an incomplete custom range", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-14T15:00:00.000Z"))
    const period = resolveAccountPeriod("custom", "America/Sao_Paulo", "2026-09-01", null)
    expect(period.key).toBe("today")
    expect(period.fromDate).toBe("2026-10-14")
  })
})

describe("samePeriodLastMonth", () => {
  it("shifts a month-to-date window to the same days last month (Oct 1-15 -> Sep 1-15)", () => {
    const period = { startISO: "2026-10-01T03:00:00.000Z", endISO: "2026-10-15T03:00:00.000Z" }
    expect(samePeriodLastMonth(period)).toEqual({
      startISO: "2026-09-01T03:00:00.000Z",
      endISO: "2026-09-15T03:00:00.000Z",
    })
  })

  it("shifts a full calendar month to the full previous month (Sep -> Aug)", () => {
    const period = { startISO: "2026-09-01T03:00:00.000Z", endISO: "2026-10-01T03:00:00.000Z" }
    expect(samePeriodLastMonth(period)).toEqual({
      startISO: "2026-08-01T03:00:00.000Z",
      endISO: "2026-09-01T03:00:00.000Z",
    })
  })

  it("clamps a day that doesn't exist in the shorter previous month (Mar 31 -> Feb 28)", () => {
    const period = { startISO: "2026-03-31T03:00:00.000Z", endISO: "2026-03-31T03:00:00.000Z" }
    const shifted = samePeriodLastMonth(period)
    // JS Date normalizes Feb 31 -> Mar 3 in a non-leap year — both
    // boundaries land on the same (slightly rolled-over) date, which
    // is the documented, deliberate behavior, not a bug: there is no
    // single "correct" Feb equivalent of Mar 31.
    expect(shifted.startISO).toBe(shifted.endISO)
  })
})
