import { describe, expect, it } from "vitest";

import { classifyRadarRow, isSessionWindowOpen, type RadarClassifyInput } from "./classify";

const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const THRESHOLDS = { waitingHours: 2, cooledHours: 24 };

describe("classifyRadarRow", () => {
  it("returns null when there is no last message at all", () => {
    expect(classifyRadarRow({ last_message_sender_type: null, last_message_at: null }, THRESHOLDS, NOW)).toBeNull();
  });

  it("awaiting_us: customer spoke last and it's been >= waitingHours", () => {
    const input: RadarClassifyInput = {
      last_message_sender_type: "customer",
      last_message_at: ago(2 * 60 * 60_000),
    };
    expect(classifyRadarRow(input, THRESHOLDS, NOW)).toBe("awaiting_us");
  });

  it("awaiting_us: not yet, customer spoke less than waitingHours ago", () => {
    const input: RadarClassifyInput = {
      last_message_sender_type: "customer",
      last_message_at: ago(119 * 60_000),
    };
    expect(classifyRadarRow(input, THRESHOLDS, NOW)).toBeNull();
  });

  it("customer_cooled: agent or bot spoke last and it's been >= cooledHours", () => {
    const agentInput: RadarClassifyInput = {
      last_message_sender_type: "agent",
      last_message_at: ago(24 * 60 * 60_000),
    };
    const botInput: RadarClassifyInput = {
      last_message_sender_type: "bot",
      last_message_at: ago(25 * 60 * 60_000),
    };
    expect(classifyRadarRow(agentInput, THRESHOLDS, NOW)).toBe("customer_cooled");
    expect(classifyRadarRow(botInput, THRESHOLDS, NOW)).toBe("customer_cooled");
  });

  it("customer_cooled: not yet, under cooledHours", () => {
    const input: RadarClassifyInput = {
      last_message_sender_type: "agent",
      last_message_at: ago(23 * 60 * 60_000 + 59 * 60_000),
    };
    expect(classifyRadarRow(input, THRESHOLDS, NOW)).toBeNull();
  });

  it("respects custom thresholds (the 'tempo' filter raising the bar)", () => {
    const input: RadarClassifyInput = {
      last_message_sender_type: "customer",
      last_message_at: ago(5 * 60 * 60_000),
    };
    expect(classifyRadarRow(input, { waitingHours: 2, cooledHours: 24 }, NOW)).toBe("awaiting_us");
    expect(classifyRadarRow(input, { waitingHours: 6, cooledHours: 24 }, NOW)).toBeNull();
  });
});

describe("isSessionWindowOpen", () => {
  it("is open just under 24h since the customer's last message", () => {
    expect(isSessionWindowOpen(ago(23 * 60 * 60_000), NOW)).toBe(true);
  });

  it("is closed at/after 24h", () => {
    expect(isSessionWindowOpen(ago(24 * 60 * 60_000), NOW)).toBe(false);
    expect(isSessionWindowOpen(ago(25 * 60 * 60_000), NOW)).toBe(false);
  });

  it("is closed when the customer was never heard from", () => {
    expect(isSessionWindowOpen(null, NOW)).toBe(false);
    expect(isSessionWindowOpen(undefined, NOW)).toBe(false);
  });
});
