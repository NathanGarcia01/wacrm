import { describe, expect, it } from "vitest"
import {
  addDaysYMD,
  mondayIndexYMD,
  parseDateKey,
  toDateKey,
  wallClockAsUtcMs,
  zonedMidnightToUtcISO,
  zonedToday,
} from "./timezone"

describe("zonedMidnightToUtcISO", () => {
  it("resolves a BRT (UTC-3, no DST) midnight to the matching UTC instant", () => {
    expect(zonedMidnightToUtcISO({ y: 2026, m: 10, d: 14 }, "America/Sao_Paulo")).toBe(
      "2026-10-14T03:00:00.000Z",
    )
  })

  it("resolves a UTC midnight to itself", () => {
    expect(zonedMidnightToUtcISO({ y: 2026, m: 10, d: 14 }, "UTC")).toBe("2026-10-14T00:00:00.000Z")
  })
})

describe("wallClockAsUtcMs", () => {
  it("reads the wall-clock date/time as observed in a given timezone", () => {
    // 2026-10-14T03:00:00Z is midnight in São Paulo (UTC-3).
    const ms = Date.parse("2026-10-14T03:00:00.000Z")
    expect(wallClockAsUtcMs(ms, "America/Sao_Paulo")).toBe(Date.UTC(2026, 9, 14, 0, 0, 0))
  })
})

describe("zonedToday", () => {
  it("can disagree with the UTC calendar day near midnight — the whole point of this module", () => {
    // 2026-10-14T23:30:00-03:00 == 2026-10-15T02:30:00Z: still Oct 14
    // in São Paulo, already Oct 15 in UTC.
    const RealDate = Date
    class FixedDate extends RealDate {
      constructor() {
        super("2026-10-15T02:30:00.000Z")
      }
    }
    // @ts-expect-error — test-only Date override, restored immediately after.
    global.Date = FixedDate
    try {
      expect(zonedToday("America/Sao_Paulo")).toEqual({ y: 2026, m: 10, d: 14 })
      expect(zonedToday("UTC")).toEqual({ y: 2026, m: 10, d: 15 })
    } finally {
      global.Date = RealDate
    }
  })
})

describe("addDaysYMD", () => {
  it("adds days, rolling over month boundaries", () => {
    expect(addDaysYMD({ y: 2026, m: 10, d: 30 }, 3)).toEqual({ y: 2026, m: 11, d: 2 })
  })

  it("subtracts days, rolling over year boundaries", () => {
    expect(addDaysYMD({ y: 2026, m: 1, d: 2 }, -3)).toEqual({ y: 2025, m: 12, d: 30 })
  })
})

describe("mondayIndexYMD", () => {
  it("maps Wednesday to index 2", () => {
    // 2026-10-14 is a Wednesday.
    expect(mondayIndexYMD({ y: 2026, m: 10, d: 14 })).toBe(2)
  })

  it("maps Monday to index 0 and Sunday to index 6", () => {
    expect(mondayIndexYMD({ y: 2026, m: 10, d: 12 })).toBe(0) // Monday
    expect(mondayIndexYMD({ y: 2026, m: 10, d: 18 })).toBe(6) // Sunday
  })
})

describe("toDateKey / parseDateKey", () => {
  it("round-trips", () => {
    const ymd = { y: 2026, m: 3, d: 5 }
    expect(parseDateKey(toDateKey(ymd))).toEqual(ymd)
  })

  it("rejects a malformed key", () => {
    expect(parseDateKey("not-a-date")).toBeNull()
  })
})
