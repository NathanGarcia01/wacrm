// ============================================================
// /api/v1/deals/[id]
//
//   GET   — single deal (`deals:read`).
//   PATCH — update fields (`deals:write`). Moving `stageId` into a
//           won stage, or setting `status`, is picked up by the same
//           DB triggers the dashboard's drag-and-drop path relies on
//           (`deals_apply_won_stage`, `deals_set_won_at`/`_lost_at`).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { isUuid } from '@/lib/api/v1/pagination';
import { badRequest, notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS =
  'id, pipeline_id, stage_id, contact_id, title, value, currency, notes, expected_close_date, status, assigned_to, won_at, lost_at, created_at, updated_at';

const VALID_STATUSES = ['open', 'won', 'lost'] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();

    const { data, error } = await ctx.supabase
      .from('deals')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound();

    return ok({ deal: data });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();

    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      value?: unknown;
      currency?: unknown;
      notes?: unknown;
      status?: unknown;
      contactId?: unknown;
      pipelineId?: unknown;
      stageId?: unknown;
      expectedCloseDate?: unknown;
    } | null;
    if (!body) throw badRequest('Request body must be JSON');

    const patch: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) throw badRequest("'title' must be a non-empty string");
      patch.title = body.title.trim();
    }
    if (body.value !== undefined) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value)) throw badRequest("'value' must be a number");
      patch.value = body.value;
    }
    if (body.currency !== undefined) {
      if (typeof body.currency !== 'string' || !body.currency) throw badRequest("'currency' must be a non-empty string");
      patch.currency = body.currency;
    }
    if (body.notes !== undefined) {
      if (body.notes !== null && typeof body.notes !== 'string') throw badRequest("'notes' must be a string or null");
      patch.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    }
    if (body.status !== undefined) {
      if (!(VALID_STATUSES as readonly string[]).includes(body.status as string)) {
        throw badRequest(`'status' must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      patch.status = body.status;
    }
    if (body.expectedCloseDate !== undefined) {
      if (body.expectedCloseDate !== null && typeof body.expectedCloseDate !== 'string') {
        throw badRequest("'expectedCloseDate' must be a date string or null");
      }
      patch.expected_close_date = body.expectedCloseDate ?? null;
    }

    if (body.contactId !== undefined) {
      if (body.contactId !== null && typeof body.contactId !== 'string') {
        throw badRequest("'contactId' must be a string or null");
      }
      if (body.contactId) {
        const { data: contact } = await ctx.supabase
          .from('contacts')
          .select('id')
          .eq('id', body.contactId)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (!contact) throw badRequest('Invalid contactId');
      }
      patch.contact_id = body.contactId ?? null;
    }

    if (body.pipelineId !== undefined || body.stageId !== undefined) {
      const pipelineId = typeof body.pipelineId === 'string' ? body.pipelineId : '';
      const stageId = typeof body.stageId === 'string' ? body.stageId : '';
      if (!pipelineId || !stageId) throw badRequest("'pipelineId' and 'stageId' must be sent together");
      const { data: stage } = await ctx.supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, pipelines!inner(id, account_id)')
        .eq('id', stageId)
        .eq('pipeline_id', pipelineId)
        .maybeSingle();
      const pipelineRow = Array.isArray(stage?.pipelines) ? stage?.pipelines[0] : stage?.pipelines;
      if (!stage || pipelineRow?.account_id !== ctx.accountId) throw badRequest('Invalid pipelineId/stageId');
      patch.pipeline_id = pipelineId;
      patch.stage_id = stageId;
    }

    if (Object.keys(patch).length === 0) throw badRequest('No fields to update');

    const { data, error } = await ctx.supabase
      .from('deals')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SELECT_COLUMNS)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound();

    return ok({ deal: data });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
