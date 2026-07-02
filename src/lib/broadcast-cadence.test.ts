import { describe, expect, it } from "vitest";
import {
  isWithinBusinessHours,
  nextBusinessHoursStart,
  estimateCadence,
} from "./broadcast-cadence";

describe("isWithinBusinessHours", () => {
  it("is true at 08:00 and 19:59 BRT, false at 07:59 and 20:00", () => {
    // BRT is a flat UTC-3 (no DST since 2019), so BRT hour = UTC hour - 3.
    expect(isWithinBusinessHours(new Date("2026-05-18T11:00:00Z"))).toBe(true); // 08:00 BRT
    expect(isWithinBusinessHours(new Date("2026-05-18T22:59:00Z"))).toBe(true); // 19:59 BRT
    expect(isWithinBusinessHours(new Date("2026-05-18T10:59:00Z"))).toBe(false); // 07:59 BRT
    expect(isWithinBusinessHours(new Date("2026-05-18T23:00:00Z"))).toBe(false); // 20:00 BRT
  });
});

describe("nextBusinessHoursStart", () => {
  it("snaps forward to 08:00 BRT the same day when still before the window", () => {
    // 03:00 BRT -> 06:00 UTC
    const next = nextBusinessHoursStart(new Date("2026-05-18T06:00:00Z"));
    expect(next.toISOString()).toBe("2026-05-18T11:00:00.000Z"); // 08:00 BRT same day
  });

  it("snaps forward to 08:00 BRT the next day when past the window", () => {
    // 2026-05-19T00:00:00Z = 2026-05-18T21:00:00 BRT (past the 20:00 cutoff)
    const next = nextBusinessHoursStart(new Date("2026-05-19T00:00:00Z"));
    expect(next.toISOString()).toBe("2026-05-19T11:00:00.000Z"); // 08:00 BRT on 05-19
  });
});

describe("estimateCadence", () => {
  it("returns zeroed estimate for an empty audience", () => {
    expect(
      estimateCadence(0, {
        batchSize: 50,
        batchIntervalMinutes: 10,
        messageDelayMinSeconds: 3,
        messageDelayMaxSeconds: 8,
        respectBusinessHours: true,
      }),
    ).toEqual({ totalBatches: 0, lowSeconds: 0, highSeconds: 0 });
  });

  it("computes batches and a low/high send-time range", () => {
    const estimate = estimateCadence(120, {
      batchSize: 50,
      batchIntervalMinutes: 10,
      messageDelayMinSeconds: 3,
      messageDelayMaxSeconds: 8,
      respectBusinessHours: true,
    });
    // ceil(120/50) = 3 batches, 2 pauses of 10min = 1200s
    expect(estimate.totalBatches).toBe(3);
    expect(estimate.lowSeconds).toBe(120 * 3 + 1200);
    expect(estimate.highSeconds).toBe(120 * 8 + 1200);
  });
});
