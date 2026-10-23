import { describe, it, expect } from "vitest";
import {
  computeConversationListStatus,
  formatPhoneTail,
  formatWaitingDuration,
  formatListTimestamp,
  toDisplayTitleCase,
  getAvatarInitials,
  getAvatarColor,
} from "./conversation-list-status";

const NOW = new Date("2026-10-05T12:00:00Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("computeConversationListStatus", () => {
  it("is null when there's no last message yet", () => {
    expect(computeConversationListStatus({}, NOW)).toBeNull();
  });

  it("is red (waitingSince) when the customer's message is the last one", () => {
    const result = computeConversationListStatus(
      {
        last_message_sender_type: "customer",
        last_message_at: hoursAgo(0.2), // 12 min
      },
      NOW,
    );
    expect(result?.tone).toBe("red");
    expect(result?.key).toBe("waitingSince");
    expect(result?.waitingMinutes).toBe(12);
  });

  it("is gray (outsideWindow) when we replied but the customer never wrote", () => {
    const result = computeConversationListStatus(
      {
        last_message_sender_type: "agent",
        last_message_at: hoursAgo(1),
        last_customer_message_at: null,
      },
      NOW,
    );
    expect(result).toEqual({ tone: "gray", key: "outsideWindow" });
  });

  it("is green (respondedWaiting) well inside the 24h window", () => {
    const result = computeConversationListStatus(
      {
        last_message_sender_type: "agent",
        last_message_at: hoursAgo(1),
        last_customer_message_at: hoursAgo(2),
      },
      NOW,
    );
    expect(result).toEqual({ tone: "green", key: "respondedWaiting" });
  });

  it("is amber (windowClosingIn) with 4h or less left", () => {
    const result = computeConversationListStatus(
      {
        last_message_sender_type: "agent",
        last_message_at: hoursAgo(0.5),
        last_customer_message_at: hoursAgo(21), // 3h left
      },
      NOW,
    );
    expect(result?.tone).toBe("amber");
    expect(result?.key).toBe("windowClosingIn");
    expect(result?.hoursLeft).toBe(3);
  });

  it("is gray (outsideWindow) once the 24h window has fully closed", () => {
    const result = computeConversationListStatus(
      {
        last_message_sender_type: "agent",
        last_message_at: hoursAgo(1),
        last_customer_message_at: hoursAgo(30),
      },
      NOW,
    );
    expect(result).toEqual({ tone: "gray", key: "outsideWindow" });
  });
});

describe("formatWaitingDuration", () => {
  it("splits minutes into hours + remainder", () => {
    expect(formatWaitingDuration(12)).toEqual({ hours: 0, minutes: 12 });
    expect(formatWaitingDuration(94)).toEqual({ hours: 1, minutes: 34 });
  });
});

describe("formatPhoneTail", () => {
  it("formats the last 8 digits as XXXX-XXXX", () => {
    expect(formatPhoneTail("5511951040903")).toBe("5104-0903");
  });

  it("returns null for missing or too-short input", () => {
    expect(formatPhoneTail(null)).toBeNull();
    expect(formatPhoneTail("12345")).toBeNull();
  });
});

describe("formatListTimestamp", () => {
  it("is a bare HH:mm for today", () => {
    // Local-time-dependent on purpose (the function renders in the
    // viewer's local time) — the expected label is derived the same
    // way so this test is portable across the runner's TZ.
    const iso = "2026-10-05T09:05:00Z";
    const d = new Date(iso);
    const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(formatListTimestamp(iso, NOW)).toEqual({ kind: "time", label: expected });
  });

  it("is 'yesterday' for the previous calendar day, even close to midnight", () => {
    expect(formatListTimestamp("2026-10-04T23:50:00Z", NOW)).toEqual({ kind: "yesterday" });
  });

  it("is dd/MM for anything older", () => {
    expect(formatListTimestamp("2026-09-20T10:00:00Z", NOW)).toEqual({
      kind: "date",
      label: "20/09",
    });
  });

  it("is null when there's no timestamp", () => {
    expect(formatListTimestamp(null, NOW)).toBeNull();
  });
});

describe("toDisplayTitleCase", () => {
  it("title-cases while lowercasing BR name particles", () => {
    expect(toDisplayTitleCase("RODNEIA MARIA BRITO")).toBe("Rodneia Maria Brito");
    expect(toDisplayTitleCase("joão de souza e silva")).toBe("João de Souza e Silva");
    expect(toDisplayTitleCase("maria dos santos")).toBe("Maria dos Santos");
  });
});

describe("getAvatarInitials", () => {
  it("uses first + last word", () => {
    expect(getAvatarInitials("Rodneia Maria Brito")).toBe("RB");
  });

  it("falls back to a single initial for one-word names", () => {
    expect(getAvatarInitials("Rodneia")).toBe("R");
  });
});

describe("getAvatarColor", () => {
  it("is deterministic for the same name", () => {
    expect(getAvatarColor("Rodneia Maria Brito")).toEqual(getAvatarColor("Rodneia Maria Brito"));
  });
});
