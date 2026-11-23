// ============================================================
// GET /api/v1/conversations/[id] — single conversation (`conversations:read`).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { isUuid } from '@/lib/api/v1/pagination';
import { notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS =
  'id, contact_id, status, assigned_agent_id, channel_id, last_message_text, last_message_at, unread_count, created_at, updated_at';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound();

    return ok({ conversation: data });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
