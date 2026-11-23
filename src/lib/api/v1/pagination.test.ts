import { describe, expect, it } from 'vitest';

import { ApiError } from './respond';
import { applyCursor, decodeCursor, encodeCursor, isUuid, paginate, parseLimit } from './pagination';

describe('parseLimit', () => {
  it('defaults to 25 when absent', () => {
    expect(parseLimit(null)).toBe(25);
  });

  it('clamps above the 100 ceiling', () => {
    expect(parseLimit('500')).toBe(100);
  });

  it('falls back to the default on garbage input', () => {
    expect(parseLimit('not-a-number')).toBe(25);
    expect(parseLimit('-5')).toBe(25);
    expect(parseLimit('0')).toBe(25);
  });

  it('accepts a valid in-range value', () => {
    expect(parseLimit('10')).toBe(10);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a row', () => {
    const row = { created_at: '2026-01-01T00:00:00.000Z', id: 'abc-123' };
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded).toEqual({ createdAt: row.created_at, id: row.id });
  });

  it('returns null for an absent cursor', () => {
    expect(decodeCursor(null)).toBeNull();
  });

  it('throws a bad_request ApiError on a malformed cursor', () => {
    expect(() => decodeCursor('not-base64url-garbage-!!!')).toThrow(ApiError);
    try {
      decodeCursor('not-base64url-garbage-!!!');
    } catch (err) {
      expect((err as ApiError).code).toBe('bad_request');
      expect((err as ApiError).status).toBe(400);
    }
  });

  it('rejects a cursor with no separator', () => {
    const noSep = Buffer.from('nosep', 'utf8').toString('base64url');
    expect(() => decodeCursor(noSep)).toThrow(ApiError);
  });

  it('rejects a cursor whose timestamp half is not a valid date', () => {
    const bad = Buffer.from('not-a-date|some-id', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(ApiError);
  });
});

describe('applyCursor', () => {
  it('is a no-op when there is no cursor', () => {
    const calls: string[] = [];
    const query = { or: (f: string) => (calls.push(f), query) };
    applyCursor(query, null);
    expect(calls).toHaveLength(0);
  });

  it('builds a keyset OR filter across created_at and the id tie-break', () => {
    const calls: string[] = [];
    const query = { or: (f: string) => (calls.push(f), query) };
    applyCursor(query, { createdAt: '2026-01-01T00:00:00.000Z', id: 'row-9' });
    expect(calls[0]).toBe(
      'created_at.lt.2026-01-01T00:00:00.000Z,and(created_at.eq.2026-01-01T00:00:00.000Z,id.lt.row-9)',
    );
  });
});

describe('paginate', () => {
  const row = (i: number) => ({ id: `id-${i}`, created_at: `2026-01-0${i}T00:00:00.000Z` });

  it('reports no next page when rows fit within the limit', () => {
    const { items, nextCursor } = paginate([row(1), row(2)], 5);
    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it('trims the lookahead row and encodes the cursor from the last returned row', () => {
    const rows = [row(1), row(2), row(3)]; // caller fetched limit(2)+1
    const { items, nextCursor } = paginate(rows, 2);
    expect(items).toHaveLength(2);
    expect(items[items.length - 1]).toEqual(row(2));
    expect(nextCursor).toBe(encodeCursor(row(2)));
    expect(nextCursor).not.toBe(encodeCursor(row(3)));
  });
});

describe('isUuid', () => {
  it('accepts a well-formed uuid', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejects non-uuid strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid("1=1' OR '1'='1")).toBe(false);
  });
});
