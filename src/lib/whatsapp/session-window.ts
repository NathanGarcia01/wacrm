import type { WhatsAppChannelType } from "@/types";

/** Meta enforces this; not configurable. */
export const SESSION_WINDOW_HOURS = 24;

export interface SessionWindowMessage {
  sender_type: string;
  created_at: string;
}

export type SessionWindowStatus =
  /** Channel is explicitly `evolution` — the 24h window is a Cloud
   *  API rule Meta enforces server-side; Evolution channels are
   *  unofficial WhatsApp Web sessions with no such limit. Nothing
   *  session-related may show or block. */
  | "not-applicable"
  /** `cloud_api`, but `messages` hasn't loaded yet — distinct from
   *  "no-customer-message" so the UI doesn't flash "expired" while a
   *  conversation's messages are still in flight. */
  | "loading"
  /** `cloud_api`, messages loaded, but none from the customer. */
  | "no-customer-message"
  | "expired"
  | "active";

export interface SessionWindowState {
  status: SessionWindowStatus;
  /** Only set when `status === "active"` — hours left in the window,
   *  as a float (callers floor it for display at whatever precision
   *  they need, same as before this was extracted). */
  hoursLeft: number | null;
}

/**
 * Fase 2 — pure, testable extraction of the 24h customer-session
 * calculation that used to live inline in message-thread.tsx's
 * `sessionInfo`. Same math, plus the channel-type gate that was
 * missing before (the bug this extraction exists to fix): the old
 * version ran unconditionally, so Evolution channels incorrectly
 * showed the countdown badge and got their composer locked too.
 *
 * Fail-closed on an unresolved channel type: `null`/`undefined`
 * (channel still loading, or — verified against production data —
 * ~3300 legacy conversations across 2 accounts with `channel_id
 * is null` and, in one case, zero `whatsapp_channels` rows at all,
 * all predating Evolution support) is treated as `cloud_api`, NOT
 * as "not applicable". Every one of those conversations was created
 * before this schema could represent anything other than Cloud API,
 * so defaulting them to "no window" would have been the wrong kind
 * of wrong — it silently turns the lock OFF instead of just failing
 * to turn it on. Only an explicit `'evolution'` disables the window.
 */
export function computeSessionWindow(
  messages: SessionWindowMessage[],
  channelType: WhatsAppChannelType | null | undefined,
  now: Date = new Date(),
): SessionWindowState {
  if (channelType === "evolution") {
    return { status: "not-applicable", hoursLeft: null };
  }

  if (messages.length === 0) {
    return { status: "loading", hoursLeft: null };
  }

  const lastCustomerMessage = [...messages].reverse().find((m) => m.sender_type === "customer");
  if (!lastCustomerMessage) {
    return { status: "no-customer-message", hoursLeft: null };
  }

  const hoursSince =
    (now.getTime() - new Date(lastCustomerMessage.created_at).getTime()) / (1000 * 60 * 60);
  if (hoursSince >= SESSION_WINDOW_HOURS) {
    return { status: "expired", hoursLeft: null };
  }

  return { status: "active", hoursLeft: SESSION_WINDOW_HOURS - hoursSince };
}
