// ============================================================
// DELETE /api/v1/contacts/[id]/tags/[tagId] — unlink a tag from a
// contact (`tags:write`). No-op success if it wasn't linked — same
// "end state already true" reasoning as the POST link route.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { isUuid } from '@/lib/api/v1/pagination';
import { notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'tags:write');
    const { id, tagId } = await params;
    if (!isUuid(id) || !isUuid(tagId)) throw notFound();

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contact) throw notFound();

    const { error } = await ctx.supabase
      .from('contact_tags')
      .delete()
      .eq('contact_id', id)
      .eq('tag_id', tagId);
    if (error) throw error;

    return ok({ linked: false });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
