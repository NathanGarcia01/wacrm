import { describe, it, expect } from "vitest";
import { computeSessionWindow, SESSION_WINDOW_HOURS } from "./session-window";

const NOW = new Date("2026-10-05T12:00:00Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("computeSessionWindow", () => {
  it("is not-applicable for an Evolution channel, regardless of messages", () => {
    const messages = [{ sender_type: "customer", created_at: hoursAgo(1) }];
    expect(computeSessionWindow(messages, "evolution", NOW)).toEqual({
      status: "not-applicable",
      hoursLeft: null,
    });
  });

  it("fails closed (behaves as cloud_api) when the channel type isn't known yet — never not-applicable", () => {
    // Verified against production: ~3300 legacy conversations predate
    // multi-channel support and have no resolvable channel_type at
    // all. They were all Cloud API by construction (Evolution didn't
    // exist yet) — treating "unknown" as "no window" would silently
    // turn the lock off for them instead of just failing to turn it
    // on. Only an explicit 'evolution' may disable the window.
    expect(computeSessionWindow([], null, NOW)).toEqual({
      status: "loading",
      hoursLeft: null,
    });
    expect(computeSessionWindow([], undefined, NOW)).toEqual({
      status: "loading",
      hoursLeft: null,
    });
    const messages = [{ sender_type: "customer", created_at: hoursAgo(1) }];
    const result = computeSessionWindow(messages, null, NOW);
    expect(result.status).toBe("active");
    expect(result.hoursLeft).toBeCloseTo(SESSION_WINDOW_HOURS - 1, 5);
  });

  it("is loading (not expired) when cloud_api but messages haven't arrived yet", () => {
    expect(computeSessionWindow([], "cloud_api", NOW)).toEqual({
      status: "loading",
      hoursLeft: null,
    });
  });

  it("is no-customer-message when messages exist but none is from the customer", () => {
    const messages = [
      { sender_type: "agent", created_at: hoursAgo(1) },
      { sender_type: "bot", created_at: hoursAgo(2) },
    ];
    expect(computeSessionWindow(messages, "cloud_api", NOW)).toEqual({
      status: "no-customer-message",
      hoursLeft: null,
    });
  });

  it("is active with hours remaining when within the 24h window", () => {
    const messages = [{ sender_type: "customer", created_at: hoursAgo(5) }];
    const result = computeSessionWindow(messages, "cloud_api", NOW);
    expect(result.status).toBe("active");
    expect(result.hoursLeft).toBeCloseTo(SESSION_WINDOW_HOURS - 5, 5);
  });

  it("uses the most recent customer message, not the first", () => {
    const messages = [
      { sender_type: "customer", created_at: hoursAgo(23) },
      { sender_type: "agent", created_at: hoursAgo(10) },
      { sender_type: "customer", created_at: hoursAgo(1) },
    ];
    const result = computeSessionWindow(messages, "cloud_api", NOW);
    expect(result.status).toBe("active");
    expect(result.hoursLeft).toBeCloseTo(SESSION_WINDOW_HOURS - 1, 5);
  });

  it("is expired exactly at the 24h boundary", () => {
    const messages = [{ sender_type: "customer", created_at: hoursAgo(24) }];
    expect(computeSessionWindow(messages, "cloud_api", NOW)).toEqual({
      status: "expired",
      hoursLeft: null,
    });
  });

  it("is expired past the 24h boundary", () => {
    const messages = [{ sender_type: "customer", created_at: hoursAgo(30) }];
    expect(computeSessionWindow(messages, "cloud_api", NOW)).toEqual({
      status: "expired",
      hoursLeft: null,
    });
  });

  it("is active just under the 24h boundary", () => {
    const messages = [{ sender_type: "customer", created_at: hoursAgo(23.99) }];
    const result = computeSessionWindow(messages, "cloud_api", NOW);
    expect(result.status).toBe("active");
    expect(result.hoursLeft).toBeGreaterThan(0);
  });
});
