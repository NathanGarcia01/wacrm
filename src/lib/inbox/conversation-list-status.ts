/**
 * Caixa de entrada redesign (proposta A+C), Parte 1 — per-row status
 * line + 3px color bar. Pure/testable, same style as
 * src/lib/whatsapp/session-window.ts (which this deliberately doesn't
 * reuse: that module needs the full per-conversation message array,
 * which the list never loads — see migration 120's doc comment for why
 * `last_message_sender_type` / `last_customer_message_at` are
 * denormalized onto `conversations` instead).
 */

import { SESSION_WINDOW_HOURS } from "@/lib/whatsapp/session-window";

/** Amber kicks in once the 24h window has this many hours or fewer left. */
const EXPIRING_SOON_THRESHOLD_HOURS = 4;

export type ConversationListStatusTone = "red" | "amber" | "green" | "gray";

export interface ConversationListStatus {
  tone: ConversationListStatusTone;
  /** Translation key — callers resolve to display text via next-intl so
   *  this module stays locale-agnostic, same pattern session-window.ts's
   *  consumer (message-thread.tsx) uses for its own status strings. */
  key: "waitingSince" | "windowClosingIn" | "respondedWaiting" | "outsideWindow";
  /** Minutes elapsed since the customer's message, only set for `red`. */
  waitingMinutes?: number;
  /** Hours left in the 24h window, only set for `amber`. */
  hoursLeft?: number;
}

export interface ConversationListStatusInput {
  last_message_sender_type?: string | null;
  last_message_at?: string | null;
  last_customer_message_at?: string | null;
}

export function computeConversationListStatus(
  conv: ConversationListStatusInput,
  now: Date = new Date(),
): ConversationListStatus | null {
  if (!conv.last_message_at || !conv.last_message_sender_type) return null;

  if (conv.last_message_sender_type === "customer") {
    const minutes = Math.max(
      0,
      Math.round((now.getTime() - new Date(conv.last_message_at).getTime()) / 60000),
    );
    return { tone: "red", key: "waitingSince", waitingMinutes: minutes };
  }

  // Last message was ours (agent/bot) — status depends on how much of
  // the customer's 24h window is left, which is tracked independently
  // of last_message_at (that's OUR message, not theirs).
  if (!conv.last_customer_message_at) {
    // Never heard from this contact — nothing to have a window on.
    return { tone: "gray", key: "outsideWindow" };
  }
  const hoursSince =
    (now.getTime() - new Date(conv.last_customer_message_at).getTime()) / (1000 * 60 * 60);
  const hoursLeft = SESSION_WINDOW_HOURS - hoursSince;

  if (hoursLeft <= 0) return { tone: "gray", key: "outsideWindow" };
  if (hoursLeft <= EXPIRING_SOON_THRESHOLD_HOURS) {
    return { tone: "amber", key: "windowClosingIn", hoursLeft: Math.max(1, Math.ceil(hoursLeft)) };
  }
  return { tone: "green", key: "respondedWaiting" };
}

/** "12 min" / "1h 34min" style duration for the red "waiting since" line. */
export function formatWaitingDuration(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/**
 * Last-8-digits-hyphenated tag shown on every list row ("5104-0903") —
 * the trailing block of the sending number, same shape a BR phone's
 * last block reads as. Falls back to null (caller hides the tag) rather
 * than a partial/odd-looking tag for very short inputs.
 */
export function formatPhoneTail(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const last8 = digits.slice(-8);
  return `${last8.slice(0, 4)}-${last8.slice(4)}`;
}
