// ============================================================
// /api/v1/tags
//
//   GET  — list this account's tags (`tags:read`), cursor-paginated.
//   POST — create a tag (`tags:write`). `tags` has no unique
//          constraint on (account_id, name) — same as the dashboard's
//          own tag manager, duplicates by name are allowed; this
//          route doesn't add a check the rest of the app doesn't have.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { resolveApiOwnerId } from '@/lib/api/v1/owner';
import { applyCursor, decodeCursor, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { badRequest, forbidden, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS = 'id, name, color, created_at';
const MAX_NAME_LEN = 60;
const DEFAULT_COLOR = '#3b82f6';
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tags:read');
    const url = new URL(request.url);

    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    let query = ctx.supabase
      .from('tags')
      .select(SELECT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    query = applyCursor(query, cursor);

    const { data, error } = await query;
    if (error) throw error;

    const { items, nextCursor } = paginate(data ?? [], limit);
    return ok({ items, nextCursor });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tags:write');

    const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) throw badRequest("'name' is required");
    if (name.length > MAX_NAME_LEN) throw badRequest(`'name' must be ${MAX_NAME_LEN} characters or fewer`);

    const color = typeof body?.color === 'string' && body.color ? body.color : DEFAULT_COLOR;
    if (!HEX_COLOR_RE.test(color)) throw badRequest("'color' must be a hex color like #3b82f6");

    const ownerId = await resolveApiOwnerId(ctx.supabase, ctx.accountId, ctx.createdBy);
    if (!ownerId) throw forbidden('Could not determine an owner for this account');

    const { data, error } = await ctx.supabase
      .from('tags')
      .insert({ account_id: ctx.accountId, user_id: ownerId, name, color })
      .select(SELECT_COLUMNS)
      .single();

    if (error) throw error;

    return ok({ tag: data }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
