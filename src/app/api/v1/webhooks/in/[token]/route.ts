// ============================================================
// POST /api/v1/webhooks/in/[token] — public lead-capture webhook.
//
// The URL itself (token in the path) is the only credential — no
// `Authorization` header, so landing-page builders / ad platforms /
// Zapier-style tools can POST straight to it. Accepts both
// `application/json` and `application/x-www-form-urlencoded` (most
// external form builders default to the latter).
//
// Flow: hash the token → look up an *active* `lead_sources` row →
// gate the account's plan (`hasAPI`) → rate-limit per token → run
// `captureLead` → log the attempt to `lead_source_events` either way.
//
// Unknown/revoked token and a plan without `hasAPI` both read as
// "this URL doesn't work right now" to the caller — we don't
// distinguish "wrong token" from "right token, downgraded account" on
// the wire, same non-disclosure stance as every other public-API 401/404.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/leads/admin-client';
import { hashLeadSourceToken } from '@/lib/leads/token';
import { captureLead, type LeadCapturePayload, type LeadSourceConfig } from '@/lib/leads/capture';
import { getAccountPlanFeatures } from '@/lib/billing/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { badRequest, forbidden, notFound, ok, rateLimited, toApiErrorResponse } from '@/lib/api/v1/respond';

interface LeadSourceRow {
  id: string;
  account_id: string;
  pipeline_id: string;
  stage_id: string;
  lead_origin_id: string | null;
  created_by: string | null;
}

/** First matching key, trying PT-BR aliases before the canonical
 *  English name — most Brazilian form builders (RD Station,
 *  Elementor, HubSpot forms localized to pt-BR) send `telefone`/`nome`. */
function firstString(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const json = await request.json().catch(() => null);
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  // No/unknown content-type — try JSON first (curl without
  // `-H "Content-Type"` still sends a parseable body), fall back to
  // empty rather than 500ing on a body we can't make sense of.
  const text = await request.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toPayload(body: Record<string, unknown>): LeadCapturePayload {
  return {
    phone: firstString(body, ['phone', 'telefone', 'whatsapp', 'celular']) ?? '',
    name: firstString(body, ['name', 'nome']) ?? null,
    email: firstString(body, ['email', 'e-mail']) ?? null,
    company: firstString(body, ['company', 'empresa']) ?? null,
  };
}

/** Summary logged to `lead_source_events` — only the fields the
 *  capture actually read, truncated, never the raw request body
 *  (see migration 139's comment on `payload_summary`). */
function summarize(payload: LeadCapturePayload): Record<string, unknown> {
  const truncate = (v: string | null | undefined) => (v ? v.slice(0, 120) : null);
  return {
    phone: truncate(payload.phone),
    name: truncate(payload.name),
    email: truncate(payload.email),
    company: truncate(payload.company),
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = supabaseAdmin();

  try {
    if (!token) throw notFound();

    const tokenHash = hashLeadSourceToken(token);
    const { data: source, error: sourceError } = await db
      .from('lead_sources')
      .select('id, account_id, pipeline_id, stage_id, lead_origin_id, created_by')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle<LeadSourceRow>();

    if (sourceError) {
      console.error('[webhooks/in] lead_sources lookup error:', sourceError.message);
      throw notFound();
    }
    if (!source) throw notFound();

    // Rate-limit before the plan check so a caller probing a leaked
    // token on a downgraded account still can't hammer the endpoint.
    const limit = checkRateLimit(`leadwebhook:${tokenHash}`, RATE_LIMITS.leadWebhookIn);
    if (!limit.success) throw rateLimited(limit);

    const features = await getAccountPlanFeatures(db, source.account_id);
    if (!features.hasAPI) {
      throw forbidden('Fontes de captação não estão disponíveis no plano atual desta conta');
    }

    const body = await parseBody(request);
    const payload = toPayload(body);

    if (!payload.phone) {
      await logEvent(db, source, null, 'error', undefined, undefined, 'telefone ausente no corpo da requisição', payload);
      throw badRequest("Campo de telefone ausente (envie 'phone' ou 'telefone')");
    }

    const config: LeadSourceConfig = {
      accountId: source.account_id,
      pipelineId: source.pipeline_id,
      stageId: source.stage_id,
      leadOriginId: source.lead_origin_id,
      createdBy: source.created_by,
    };

    const result = await captureLead(db, config, payload);

    await logEvent(
      db,
      source,
      result.status === 'ok' ? result.contactId ?? null : null,
      result.status,
      result.contactOutcome,
      result.dealOutcome,
      result.errorMessage ?? null,
      payload,
      result.dealId ?? null,
    );

    if (result.status === 'error') {
      throw badRequest(result.errorMessage ?? 'Falha ao processar o lead');
    }

    return ok({
      contact: { id: result.contactId, outcome: result.contactOutcome },
      deal: result.dealId ? { id: result.dealId, outcome: result.dealOutcome } : { outcome: result.dealOutcome ?? null },
    }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

async function logEvent(
  db: SupabaseClient,
  source: LeadSourceRow,
  contactId: string | null,
  status: 'ok' | 'error',
  contactOutcome: 'created' | 'matched' | undefined,
  dealOutcome: 'created' | 'skipped_duplicate' | undefined,
  errorMessage: string | null | undefined,
  payload: LeadCapturePayload,
  dealId: string | null = null,
): Promise<void> {
  const { error } = await db.from('lead_source_events').insert({
    account_id: source.account_id,
    lead_source_id: source.id,
    contact_id: contactId,
    deal_id: dealId,
    status,
    contact_outcome: contactOutcome ?? null,
    deal_outcome: dealOutcome ?? null,
    error_message: errorMessage ?? null,
    payload_summary: summarize(payload),
  });
  if (error) {
    console.error('[webhooks/in] failed to log lead_source_events:', error.message);
  }
}
