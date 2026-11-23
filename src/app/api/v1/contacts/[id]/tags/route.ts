// ============================================================
// /api/v1/contacts/[id]/tags
//
//   GET  — tags currently on a contact (`tags:read`).
//   POST — link a tag to a contact (`tags:write`). Body: `{ tagId }`.
//          `contact_tags` has a unique `(contact_id, tag_id)` index —
//          linking an already-linked tag is treated as a no-op
//          success rather than a 409, since the end state the caller
//          wants ("this tag is on this contact") is already true.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireApiKey } from '@/lib/auth/api-context';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { isUuid } from '@/lib/api/v1/pagination';
import { badRequest, notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

async function assertContactInAccount(
  supabase: SupabaseClient,
  contactId: string,
  accountId: string,
): Promise<void> {
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) throw notFound();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'tags:read');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();
    await assertContactInAccount(ctx.supabase, id, ctx.accountId);

    const { data, error } = await ctx.supabase
      .from('contact_tags')
      .select('tag_id, tags:tag_id ( id, name, color )')
      .eq('contact_id', id);
    if (error) throw error;

    const tags = (data ?? []).map((row) => (Array.isArray(row.tags) ? row.tags[0] : row.tags)).filter(Boolean);
    return ok({ items: tags });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'tags:write');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();
    await assertContactInAccount(ctx.supabase, id, ctx.accountId);

    const body = (await request.json().catch(() => null)) as { tagId?: unknown } | null;
    const tagId = typeof body?.tagId === 'string' ? body.tagId : '';
    if (!tagId || !isUuid(tagId)) throw badRequest("'tagId' must be a valid tag id");

    const { data: tag } = await ctx.supabase
      .from('tags')
      .select('id')
      .eq('id', tagId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!tag) throw badRequest('Invalid tagId');

    const { error } = await ctx.supabase.from('contact_tags').insert({ contact_id: id, tag_id: tagId });
    if (error && !isUniqueViolation(error)) throw error;

    return ok({ linked: true }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
