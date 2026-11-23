// ============================================================
// /api/account/lead-sources
//
//   GET  — roster for the "Fontes de captação" settings tab. Any
//          member can view (read-only); the secret (the token) is
//          never in this response.
//   POST — create a new source. Admin+, and the account's plan must
//          have `hasAPI` (Fase 3A gate) — same billing dimension that
//          already governs the public REST API / webhook-out.
//
// IMPORTANT: the webhook URL (token embedded in the path) is
// returned exactly ONCE, in the POST response. We persist only the
// token's SHA-256 hash, so neither this GET nor any future endpoint
// can resurface it — same one-time-reveal contract as invite links
// and API keys. If the admin loses it, they deactivate the source
// and create a new one.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getAccountPlanFeatures } from '@/lib/billing/server';
import { getPublicBaseUrl } from '@/lib/http/base-url';
import { supabaseAdmin } from '@/lib/leads/admin-client';
import { generateLeadSourceToken, leadWebhookUrl } from '@/lib/leads/token';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const MAX_NAME_LEN = 80;

const SELECT_WITH_RELATIONS = `
  id, name, is_active, created_at, created_by, pipeline_id, stage_id, lead_origin_id,
  pipelines:pipeline_id ( id, name ),
  pipeline_stages:stage_id ( id, name ),
  lead_origins:lead_origin_id ( id, label )
`;

export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const { data, error } = await ctx.supabase
      .from('lead_sources')
      .select(SELECT_WITH_RELATIONS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/account/lead-sources] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load lead sources' }, { status: 500 });
    }

    return NextResponse.json({ sources: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(`admin:leadSourceCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
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
      pipelineId?: unknown;
      stageId?: unknown;
      leadOriginId?: unknown;
    } | null;

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: "'name' é obrigatório" }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `O nome deve ter no máximo ${MAX_NAME_LEN} caracteres` },
        { status: 400 },
      );
    }

    const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId : '';
    const stageId = typeof body?.stageId === 'string' ? body.stageId : '';
    if (!pipelineId || !stageId) {
      return NextResponse.json({ error: "'pipelineId' e 'stageId' são obrigatórios" }, { status: 400 });
    }

    // Stage must belong to the given pipeline, and that pipeline must
    // belong to this account — otherwise an admin could point a lead
    // source at another account's stage by guessing a uuid. RLS on
    // pipeline_stages/pipelines already enforces the account scope on
    // this read; the explicit filters make the "not found" case precise.
    const { data: stage, error: stageError } = await ctx.supabase
      .from('pipeline_stages')
      .select('id, pipeline_id, pipelines!inner(id, account_id)')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .maybeSingle();
    if (stageError) {
      console.error('[POST /api/account/lead-sources] stage lookup error:', stageError);
      return NextResponse.json({ error: 'Failed to validate stage' }, { status: 500 });
    }
    const pipelineRow = Array.isArray(stage?.pipelines) ? stage?.pipelines[0] : stage?.pipelines;
    if (!stage || pipelineRow?.account_id !== ctx.accountId) {
      return NextResponse.json({ error: 'Etapa/pipeline inválida' }, { status: 400 });
    }

    const leadOriginId = typeof body?.leadOriginId === 'string' && body.leadOriginId ? body.leadOriginId : null;
    if (leadOriginId) {
      const { data: origin } = await ctx.supabase
        .from('lead_origins')
        .select('id')
        .eq('id', leadOriginId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!origin) {
        return NextResponse.json({ error: 'Origem de lead inválida' }, { status: 400 });
      }
    }

    const { token, hash } = generateLeadSourceToken();

    // Insert via the service-role client — `lead_sources` deliberately
    // has no INSERT policy for `authenticated` (migration 139), so the
    // RLS-scoped `ctx.supabase` would just get rejected here.
    const { data: created, error: insertError } = await supabaseAdmin()
      .from('lead_sources')
      .insert({
        account_id: ctx.accountId,
        name,
        token_hash: hash,
        pipeline_id: pipelineId,
        stage_id: stageId,
        lead_origin_id: leadOriginId,
        created_by: ctx.userId,
      })
      .select(SELECT_WITH_RELATIONS)
      .single();

    if (insertError || !created) {
      console.error('[POST /api/account/lead-sources] insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create lead source' }, { status: 500 });
    }

    return NextResponse.json(
      {
        source: created,
        // Plaintext URL — shown to the admin exactly once.
        webhookUrl: leadWebhookUrl(token, getPublicBaseUrl(request)),
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
