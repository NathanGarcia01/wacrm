// ============================================================
// PATCH /api/account/lead-sources/[id]
//
// Rename, re-point at a different pipeline/stage/origin, or toggle
// `is_active` (the de-facto "revoke" — the token itself can never be
// shown again, so disabling in place is the only way to stop a lost
// URL from working, same reasoning documented in token.ts). Admin+,
// same `hasAPI` plan gate as creation.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getAccountPlanFeatures } from '@/lib/billing/server';
import { supabaseAdmin } from '@/lib/leads/admin-client';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const MAX_NAME_LEN = 80;

const SELECT_WITH_RELATIONS = `
  id, name, is_active, created_at, created_by, pipeline_id, stage_id, lead_origin_id,
  pipelines:pipeline_id ( id, name ),
  pipeline_stages:stage_id ( id, name ),
  lead_origins:lead_origin_id ( id, label )
`;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const limit = checkRateLimit(`admin:leadSourceUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const features = await getAccountPlanFeatures(ctx.supabase, ctx.accountId);
    if (!features.hasAPI) {
      return NextResponse.json(
        {
          error:
            'Fontes de captação não estão disponíveis no seu plano atual. Faça upgrade para o plano Business.',
        },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      isActive?: unknown;
      pipelineId?: unknown;
      stageId?: unknown;
      leadOriginId?: unknown;
    } | null;

    const patch: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return NextResponse.json({ error: "'name' não pode ser vazio" }, { status: 400 });
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json({ error: `O nome deve ter no máximo ${MAX_NAME_LEN} caracteres` }, { status: 400 });
      }
      patch.name = name;
    }

    if (body?.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json({ error: "'isActive' deve ser booleano" }, { status: 400 });
      }
      patch.is_active = body.isActive;
    }

    if (body?.pipelineId !== undefined || body?.stageId !== undefined) {
      const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId : '';
      const stageId = typeof body?.stageId === 'string' ? body.stageId : '';
      if (!pipelineId || !stageId) {
        return NextResponse.json({ error: "'pipelineId' e 'stageId' devem ser enviados juntos" }, { status: 400 });
      }
      const { data: stage } = await ctx.supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, pipelines!inner(id, account_id)')
        .eq('id', stageId)
        .eq('pipeline_id', pipelineId)
        .maybeSingle();
      const pipelineRow = Array.isArray(stage?.pipelines) ? stage?.pipelines[0] : stage?.pipelines;
      if (!stage || pipelineRow?.account_id !== ctx.accountId) {
        return NextResponse.json({ error: 'Etapa/pipeline inválida' }, { status: 400 });
      }
      patch.pipeline_id = pipelineId;
      patch.stage_id = stageId;
    }

    if (body?.leadOriginId !== undefined) {
      const leadOriginId = typeof body.leadOriginId === 'string' && body.leadOriginId ? body.leadOriginId : null;
      if (leadOriginId) {
        const { data: origin } = await ctx.supabase
          .from('lead_origins')
          .select('id')
          .eq('id', leadOriginId)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (!origin) return NextResponse.json({ error: 'Origem de lead inválida' }, { status: 400 });
      }
      patch.lead_origin_id = leadOriginId;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    // Scoped by account_id too (RLS already enforces it; belt-and-
    // braces, and makes "0 rows" → 404 precise) via the service-role
    // client — same no-authenticated-write-policy reasoning as POST.
    const { data: updated, error } = await supabaseAdmin()
      .from('lead_sources')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SELECT_WITH_RELATIONS)
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/account/lead-sources/[id]] error:', error);
      return NextResponse.json({ error: 'Failed to update lead source' }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: 'Fonte não encontrada' }, { status: 404 });
    }

    return NextResponse.json({ source: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
