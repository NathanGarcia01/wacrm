// ============================================================
// /api/v1/deals
//
//   GET  — list deals (`deals:read`), cursor-paginated.
//   POST — create a deal (`deals:write`) in a given pipeline/stage.
//
// `deals_apply_won_stage` / `deals_set_won_at` / `deals_set_lost_at` /
// `deals_stage_changed_at` (DB triggers) already handle the
// won/lost/stage-change bookkeeping on every insert/update — this
// route just writes the raw columns, same as the dashboard's own
// deal-creation path.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { resolveApiOwnerId } from '@/lib/api/v1/owner';
import { applyCursor, decodeCursor, isUuid, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { badRequest, forbidden, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS =
  'id, pipeline_id, stage_id, contact_id, title, value, currency, notes, expected_close_date, status, assigned_to, won_at, lost_at, created_at, updated_at';

const VALID_STATUSES = ['open', 'won', 'lost'] as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const url = new URL(request.url);

    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    let query = ctx.supabase
      .from('deals')
      .select(SELECT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const pipelineId = url.searchParams.get('pipeline_id');
    if (pipelineId) {
      if (!isUuid(pipelineId)) throw badRequest("Invalid 'pipeline_id' parameter");
      query = query.eq('pipeline_id', pipelineId);
    }

    const stageId = url.searchParams.get('stage_id');
    if (stageId) {
      if (!isUuid(stageId)) throw badRequest("Invalid 'stage_id' parameter");
      query = query.eq('stage_id', stageId);
    }

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

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as {
      pipelineId?: unknown;
      stageId?: unknown;
      contactId?: unknown;
      title?: unknown;
      value?: unknown;
      currency?: unknown;
      notes?: unknown;
      expectedCloseDate?: unknown;
    } | null;

    const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId : '';
    const stageId = typeof body?.stageId === 'string' ? body.stageId : '';
    if (!pipelineId || !stageId) throw badRequest("'pipelineId' and 'stageId' are required");

    // Stage must belong to the given pipeline, and that pipeline must
    // belong to this account.
    const { data: stage, error: stageError } = await ctx.supabase
      .from('pipeline_stages')
      .select('id, pipeline_id, pipelines!inner(id, account_id)')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .maybeSingle();
    if (stageError) throw stageError;
    const pipelineRow = Array.isArray(stage?.pipelines) ? stage?.pipelines[0] : stage?.pipelines;
    if (!stage || pipelineRow?.account_id !== ctx.accountId) {
      throw badRequest('Invalid pipelineId/stageId');
    }

    const contactId = typeof body?.contactId === 'string' ? body.contactId : null;
    let contactTitle: string | null = null;
    if (contactId) {
      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contact) throw badRequest('Invalid contactId');
      contactTitle = contact.name || contact.phone || null;
    }

    const ownerId = await resolveApiOwnerId(ctx.supabase, ctx.accountId, ctx.createdBy);
    if (!ownerId) throw forbidden('Could not determine an owner for this account');

    const title = (typeof body?.title === 'string' ? body.title.trim() : '') || contactTitle || 'Novo negócio';

    const value = typeof body?.value === 'number' && Number.isFinite(body.value) ? body.value : 0;
    const currency = typeof body?.currency === 'string' && body.currency ? body.currency : undefined;
    const notes = typeof body?.notes === 'string' ? body.notes.trim() || null : null;
    const expectedCloseDate = typeof body?.expectedCloseDate === 'string' ? body.expectedCloseDate : null;

    const { data, error } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: ownerId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        title,
        value,
        currency,
        notes,
        expected_close_date: expectedCloseDate,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (error) throw error;

    return ok({ deal: data }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
