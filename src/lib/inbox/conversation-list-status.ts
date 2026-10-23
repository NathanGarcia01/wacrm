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

/**
 * List row timestamp — short, non-relative ("14:27" today, "Ontem",
 * "12/10" older), per the approved mockup. Deliberately NOT
 * date-fns's formatDistanceToNow ("cerca de 2 horas"), which the
 * mockup explicitly drops. Day boundaries compare local calendar days
 * against `now` (not a rolling 24h), so a message from 23:50 reads
 * "Ontem" by 00:05, matching how "Hoje"/"Ontem" actually read to a
 * human.
 */
export type ListTimestamp =
  | { kind: "time"; label: string }
  | { kind: "yesterday" }
  | { kind: "date"; label: string };

export function formatListTimestamp(
  iso: string | null | undefined,
  now: Date = new Date(),
): ListTimestamp | null {
  if (!iso) return null;
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (dayDiff <= 0) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return { kind: "time", label: `${hh}:${mm}` };
  }
  if (dayDiff === 1) return { kind: "yesterday" };
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return { kind: "date", label: `${dd}/${mo}` };
}

/**
 * Display-only Title Case, lowercasing BR name particles
 * (de/da/do/dos/das/e) — "RODNEIA MARIA BRITO" → "Rodneia Maria
 * Brito", "joão de souza e silva" → "João de Souza e Silva". Never
 * touches the stored value, only what's rendered.
 */
const LOWERCASE_NAME_PARTICLES = new Set(["de", "da", "do", "dos", "das", "e"]);

export function toDisplayTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lower = word.toLocaleLowerCase("pt-BR");
      if (i > 0 && LOWERCASE_NAME_PARTICLES.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
    })
    .join(" ");
}

/** First + last word's initial — "Rodneia Maria Brito" → "RB",
 *  single-word names → just that one initial. */
export function getAvatarInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

/**
 * Fixed 7-color palette, deterministic per name (same contact always
 * gets the same color), tuned for AA-ish contrast in both themes —
 * each pair is a soft tint background + a themed text color via
 * `dark:`, not a literal hex pulled from the mockup (per the redesign
 * brief: use the project's existing token/class conventions).
 */
const AVATAR_PALETTE: { bg: string; text: string }[] = [
  { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400" },
  { bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400" },
  { bg: "bg-amber-500/15", text: "text-amber-600 dark:text-amber-400" },
  { bg: "bg-rose-500/15", text: "text-rose-600 dark:text-rose-400" },
  { bg: "bg-cyan-500/15", text: "text-cyan-600 dark:text-cyan-400" },
  { bg: "bg-indigo-500/15", text: "text-indigo-600 dark:text-indigo-400" },
];

export function getAvatarColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
