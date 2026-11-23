// ============================================================
// GET /api/v1/conversations — list conversations (`conversations:read`),
// cursor-paginated, read-only (no POST/PATCH — Fase 3A ships messages
// and conversations read-only; sending stays on `messages:send`
// endpoints from a later release, same roadmap note as docs/public-api.md).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { applyCursor, decodeCursor, isUuid, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { badRequest, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS =
  'id, contact_id, status, assigned_agent_id, channel_id, last_message_text, last_message_at, unread_count, created_at, updated_at';

const VALID_STATUSES = ['open', 'closed', 'pending'] as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const url = new URL(request.url);

    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    let query = ctx.supabase
      .from('conversations')
      .select(SELECT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const contactId = url.searchParams.get('contact_id');
    if (contactId) {
      if (!isUuid(contactId)) throw badRequest("Invalid 'contact_id' parameter");
      query = query.eq('contact_id', contactId);
    }

    const status = url.searchParams.get('status');
    if (status) {
      if (!(VALID_STATUSES as readonly string[]).includes(status)) {
        throw badRequest(`'status' must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      query = query.eq('status', status);
    }

    query = applyCursor(query, cursor);

    const { data, error } = await query;
    if (error) throw error;

    const { items, nextCursor } = paginate(data ?? [], limit);
    return ok({ items, nextCursor });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
