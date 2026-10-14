import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveAccountPeriod } from "./period"

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
