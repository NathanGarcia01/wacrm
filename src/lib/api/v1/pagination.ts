// ============================================================
// Cursor pagination for /api/v1 list endpoints.
//
// Keyset, not offset: `?page=N` re-scans and skips/duplicates rows
// under concurrent inserts between pages; keyset on (created_at, id)
// doesn't. `id` alone can't be the cursor — every table here uses a
// random uuid_v4 primary key, not a monotonic one, so ordering by id
// has no relationship to insertion order. `created_at` is the real
// ordering key; `id` is only the tie-breaker for rows that share a
// timestamp (bulk inserts, clock granularity).
//
// Every list route follows the same shape:
//
//   const limit = parseLimit(url.searchParams.get('limit'));
//   const cursor = decodeCursor(url.searchParams.get('cursor'));
//   let query = supabase.from(...).select('*').eq('account_id', accountId)
//     .order('created_at', { ascending: false })
//     .order('id', { ascending: false })
//     .limit(limit + 1);
//   query = applyCursor(query, cursor);
//   const { data } = await query;
//   const { items, nextCursor } = paginate(data ?? [], limit);
//   return ok({ items, nextCursor });
// ============================================================

import { badRequest } from './respond';

export interface Cursor {
  createdAt: string;
  id: string;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Clamp a caller-supplied `?limit=` to [1, MAX_LIMIT]; anything
 *  missing or unparsable falls back to the default rather than 400ing
 *  — a malformed limit isn't worth failing the whole request over. */
export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(`${row.created_at}|${row.id}`, 'utf8').toString('base64url');
}

/** Throws `badRequest` (an `ApiError`) on a malformed cursor — unlike
 *  `limit`, a bad cursor means the caller's pagination state is
 *  broken and silently resetting to page 1 would hide that. */
export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw badRequest("Invalid 'cursor' parameter");
  }

  const sep = decoded.lastIndexOf('|');
  const createdAt = sep >= 0 ? decoded.slice(0, sep) : '';
  const id = sep >= 0 ? decoded.slice(sep + 1) : '';
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw badRequest("Invalid 'cursor' parameter");
  }
  return { createdAt, id };
}

/**
 * Apply the keyset filter for "rows strictly after `cursor`" given
 * descending `(created_at, id)` order. Postgrest's `.or()` with a raw
 * filter string is the only way to express the two-column tie-break
 * in one round trip.
 */
export function applyCursor<Q extends { or: (filter: string) => Q }>(
  query: Q,
  cursor: Cursor | null,
): Q {
  if (!cursor) return query;
  return query.or(
    `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  );
}

/**
 * Turns a `limit + 1` fetch into the `{ items, nextCursor }` page
 * shape: the caller always asks the DB for one extra row, so finding
 * it here means there's a next page. Trims that lookahead row and
 * encodes the cursor from the last *returned* row — never the
 * lookahead one, or the next page would skip a row.
 */
export function paginate<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate a caller-supplied id filter looks like a uuid before it
 *  hits the query builder — an obviously-malformed filter should 400,
 *  not silently match zero rows. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
