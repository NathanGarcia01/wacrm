// ============================================================
// Presence helpers — pure, unit-testable, no I/O.
//
// Mirrors the `member_presence` table from migration
// 024_member_presence.sql. The DB stores only what the active
// client reports ('online' / 'away'); "offline" is never stored
// — it is derived here from staleness so a closed tab resolves to
// offline without an unload write.
//
// `now` is always passed in (epoch ms) rather than read from the
// clock, so derivation and formatting stay deterministic and
// testable. See presence.test.ts.
// ============================================================

/** How often the active client heartbeats its own presence row. */
export const HEARTBEAT_MS = 30_000;

/**
 * A member whose last heartbeat is older than this is treated as
 * offline regardless of its stored status. ~2.5 missed beats, so a
 * single dropped heartbeat doesn't flap a member offline.
 */
export const OFFLINE_AFTER_MS = 75_000;

/** No input / hidden tab for this long flips the client to 'away'. */
export const IDLE_AFTER_MS = 5 * 60_000;

/** What the active client reports (and what the DB stores). */
export type StoredPresence = "online" | "away";

/** What a viewer sees — adds the derived 'offline' state. */
export type PresenceStatus = "online" | "away" | "offline";

/** Raw presence row as read from the `member_presence` table. */
export interface PresenceRow {
  status: StoredPresence;
  last_seen_at: string;
}

/**
 * Derive the user-facing presence for a member. A missing row, or a
 * heartbeat staler than OFFLINE_AFTER_MS, reads as offline; otherwise
 * the member's last reported status (online / away) stands.
 */
export function derivePresence(
  stored: StoredPresence | undefined,
  lastSeenAt: string | null | undefined,
  now: number,
): PresenceStatus {
  if (!stored || !lastSeenAt) return "offline";
  const last = new Date(lastSeenAt).getTime();
  if (Number.isNaN(last)) return "offline";
  if (now - last > OFFLINE_AFTER_MS) return "offline";
  return stored;
}

/** Translator shape accepted by `formatLastSeen`/`presenceLabel` — matches next-intl's `useTranslations` return type. */
export type PresenceT = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** English fallback used when no translator is supplied (keeps this module's own unit tests locale-independent). */
function defaultPresenceT(key: string, values?: Record<string, string | number | Date>): string {
  const count = typeof values?.count === "number" ? values.count : undefined;
  switch (key) {
    case "aWhileAgo":
      return "a while ago";
    case "justNow":
      return "just now";
    case "minutesAgo":
      return count === 1 ? "1 minute ago" : `${count} minutes ago`;
    case "hoursAgo":
      return count === 1 ? "1 hour ago" : `${count} hours ago`;
    case "daysAgo":
      return count === 1 ? "1 day ago" : `${count} days ago`;
    case "onlineLabel":
      return "Online — active now";
    case "awayLabel":
      return "Away — idle";
    case "offlineLabel":
      return `Offline — last seen ${values?.time}`;
    default:
      return "";
  }
}

/**
 * Relative "last seen" string for tooltips. Coarse on purpose — the
 * issue calls for relative time only, never a precise timestamp.
 *
 * Deliberately separate from `formatRelative` in
 * src/lib/automations/trigger-meta.ts: that one reads `Date.now()`
 * internally (not injectable) and emits terse chip wording ("2h ago"),
 * whereas presence needs an injected `now` — so the dots and labels
 * advance in lockstep and the unit tests stay deterministic — plus
 * full-sentence wording for the tooltip ("Offline — last seen …").
 */
export function formatLastSeen(
  lastSeenAt: string | null | undefined,
  now: number,
  t: PresenceT = defaultPresenceT,
): string {
  if (!lastSeenAt) return t("aWhileAgo");
  const last = new Date(lastSeenAt).getTime();
  if (Number.isNaN(last)) return t("aWhileAgo");

  const diff = Math.max(0, now - last);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minutesAgo", { count: mins });

  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("hoursAgo", { count: hours });

  const days = Math.floor(hours / 24);
  return t("daysAgo", { count: days });
}

/**
 * Tooltip / aria label for a presence dot, e.g.
 *   "Online — active now"
 *   "Away — idle"
 *   "Offline — last seen 2 hours ago"
 */
export function presenceLabel(
  status: PresenceStatus,
  lastSeenAt: string | null | undefined,
  now: number,
  t: PresenceT = defaultPresenceT,
): string {
  switch (status) {
    case "online":
      return t("onlineLabel");
    case "away":
      return t("awayLabel");
    case "offline":
      return t("offlineLabel", { time: formatLastSeen(lastSeenAt, now, t) });
  }
}

/** Roster header summary, e.g. for "3 online · 1 away · 1 offline". */
export function summarize(statuses: PresenceStatus[]): {
  online: number;
  away: number;
  offline: number;
} {
  const counts = { online: 0, away: 0, offline: 0 };
  for (const s of statuses) counts[s] += 1;
  return counts;
}
