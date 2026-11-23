// ============================================================
// /api/v1/contacts/[id]
//
//   GET   — single contact (`contacts:read`).
//   PATCH — update fields (`contacts:write`).
//
// Scoped by `ctx.accountId`, never the body — see contacts/route.ts.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { isUuid } from '@/lib/api/v1/pagination';
import { badRequest, notFound, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS = 'id, name, phone, email, company, status_id, lead_origin_id, created_at, updated_at';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();

    const { data, error } = await ctx.supabase
      .from('contacts')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw notFound();

    return ok({ contact: data });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const { id } = await params;
    if (!isUuid(id)) throw notFound();

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      phone?: unknown;
      email?: unknown;
      company?: unknown;
      statusId?: unknown;
      leadOriginId?: unknown;
    } | null;
    if (!body) throw badRequest('Request body must be JSON');

    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (body.name !== null && typeof body.name !== 'string') throw badRequest("'name' must be a string or null");
      patch.name = typeof body.name === 'string' ? body.name.trim() || null : null;
    }
    if (body.phone !== undefined) {
      if (typeof body.phone !== 'string' || normalizePhone(body.phone).length < 8) {
        throw badRequest("'phone' must be a valid phone number");
      }
      patch.phone = body.phone.trim();
    }
    if (body.email !== undefined) {
      if (body.email !== null && typeof body.email !== 'string') throw badRequest("'email' must be a string or null");
      patch.email = typeof body.email === 'string' ? body.email.trim() || null : null;
    }
    if (body.company !== undefined) {
      if (body.company !== null && typeof body.company !== 'string') {
        throw badRequest("'company' must be a string or null");
      }
      patch.company = typeof body.company === 'string' ? body.company.trim() || null : null;
    }
    if (body.statusId !== undefined) {
      if (body.statusId !== null && typeof body.statusId !== 'string') {
        throw badRequest("'statusId' must be a string or null");
      }
      patch.status_id = body.statusId ?? null;
    }
    if (body.leadOriginId !== undefined) {
      if (body.leadOriginId !== null && typeof body.leadOriginId !== 'string') {
        throw badRequest("'leadOriginId' must be a string or null");
      }
      patch.lead_origin_id = body.leadOriginId ?? null;
    }

    if (Object.keys(patch).length === 0) throw badRequest('No fields to update');
    // `updated_at` is set by the `set_updated_at` trigger — no need to
    // stamp it here.

    const { data, error } = await ctx.supabase
      .from('contacts')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SELECT_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error)) {
        throw badRequest('Another contact in this account already has that phone number');
      }
      throw error;
    }
    if (!data) throw notFound();

    return ok({ contact: data });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
