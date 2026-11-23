// ============================================================
// GET /api/v1/conversations/[id]/messages — messages in a
// conversation (`messages:read`), cursor-paginated, read-only.
//
// Scoped two ways: the conversation itself must belong to
// `ctx.accountId` (checked explicitly, since `messages` has no
// `account_id` column of its own — it only has `conversation_id`),
// then messages are filtered by that conversation.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { applyCursor, decodeCursor, isUuid, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS =
  'id, conversation_id, sender_type, content_type, content_text, media_url, status, created_at';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();

    const { data: conversation, error: convError } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (convError) throw convError;
    if (!conversation) throw notFound();

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    let query = ctx.supabase
      .from('messages')
      .select(SELECT_COLUMNS)
      .eq('conversation_id', id)
      .is('deleted_at', null)
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
