// ============================================================
// POST /api/account/lead-sources/[id]/test — "Disparar lead de teste".
//
// Runs the exact same `captureLead` the public webhook uses, with a
// synthetic payload, so the settings tab can prove a source actually
// works end to end (contact dedup, deal creation in the right stage)
// without the admin standing up a real form. A fresh fake phone per
// click (timestamp-suffixed) so repeated tests create distinguishable
// contacts rather than silently deduping into one "test" contact that
// could be confused with a real lead later.
//
// Still creates a real contact/deal in the configured pipeline+stage —
// this is a smoke test of the capture path, not a dry-run. Logged to
// `lead_source_events` like any other receipt, flagged `is_test` in
// `payload_summary` so the receipts list can label it.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getAccountPlanFeatures } from '@/lib/billing/server';
import { captureLead, type LeadSourceConfig } from '@/lib/leads/capture';
import { supabaseAdmin } from '@/lib/leads/admin-client';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const limit = checkRateLimit(`admin:leadSourceTest:${ctx.userId}`, RATE_LIMITS.adminAction);
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

    const { data: source, error: sourceError } = await ctx.supabase
      .from('lead_sources')
      .select('id, account_id, pipeline_id, stage_id, lead_origin_id, created_by')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (sourceError) {
      console.error('[POST /api/account/lead-sources/[id]/test] lookup error:', sourceError);
      return NextResponse.json({ error: 'Failed to load lead source' }, { status: 500 });
    }
    if (!source) {
      return NextResponse.json({ error: 'Fonte não encontrada' }, { status: 404 });
    }

    const admin = supabaseAdmin();
    const suffix = Date.now().toString().slice(-8);
    const payload = {
      phone: `+5511${suffix}`,
      name: `Lead de teste ${suffix}`,
      email: null,
      company: null,
    };

    const config: LeadSourceConfig = {
      accountId: source.account_id,
      pipelineId: source.pipeline_id,
      stageId: source.stage_id,
      leadOriginId: source.lead_origin_id,
      createdBy: source.created_by,
    };

    const result = await captureLead(admin, config, payload);

    const { error: logError } = await admin.from('lead_source_events').insert({
      account_id: source.account_id,
      lead_source_id: source.id,
      contact_id: result.contactId ?? null,
      deal_id: result.dealId ?? null,
      status: result.status,
      contact_outcome: result.contactOutcome ?? null,
      deal_outcome: result.dealOutcome ?? null,
      error_message: result.errorMessage ?? null,
      payload_summary: { ...payload, is_test: true },
    });
    if (logError) {
      console.error('[POST /api/account/lead-sources/[id]/test] failed to log event:', logError);
    }

    return NextResponse.json({ result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
