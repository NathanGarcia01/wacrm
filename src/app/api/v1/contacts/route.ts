// ============================================================
// /api/v1/contacts
//
//   GET  — list contacts (`contacts:read`), cursor-paginated.
//   POST — create-or-match a contact by phone (`contacts:write`),
//          same dedup rule the WhatsApp webhook / manual form / CSV
//          import already agree on (issue #212).
//
// Every query is scoped by `ctx.accountId` from the resolved API key
// — never from the request body — so a key can only ever see/touch
// its own account's contacts.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { resolveApiOwnerId } from '@/lib/api/v1/owner';
import { applyCursor, decodeCursor, isUuid, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { badRequest, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

const SELECT_COLUMNS = 'id, name, phone, email, company, status_id, lead_origin_id, created_at, updated_at';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const url = new URL(request.url);

    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    let query = ctx.supabase
      .from('contacts')
      .select(SELECT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const phone = url.searchParams.get('phone');
    if (phone) query = query.eq('phone_normalized', normalizePhone(phone));

    const email = url.searchParams.get('email');
    if (email) query = query.eq('email', email);

    const statusId = url.searchParams.get('status_id');
    if (statusId) {
      if (!isUuid(statusId)) throw badRequest("Invalid 'status_id' parameter");
      query = query.eq('status_id', statusId);
    }

    const leadOriginId = url.searchParams.get('lead_origin_id');
    if (leadOriginId) {
      if (!isUuid(leadOriginId)) throw badRequest("Invalid 'lead_origin_id' parameter");
      query = query.eq('lead_origin_id', leadOriginId);
    }

    query = applyCursor(query, cursor);

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/v1/contacts] query error:', error.message);
      throw error;
    }

    const { items, nextCursor } = paginate(data ?? [], limit);
    return ok({ items, nextCursor });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = (await request.json().catch(() => null)) as {
      phone?: unknown;
      name?: unknown;
      email?: unknown;
      company?: unknown;
      statusId?: unknown;
      leadOriginId?: unknown;
    } | null;

    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if (!phone || normalizePhone(phone).length < 8) {
      throw badRequest("'phone' is required and must be a valid phone number");
    }

    const existing = await findExistingContact(ctx.supabase, ctx.accountId, phone);
    if (existing) {
      const { data } = await ctx.supabase
        .from('contacts')
        .select(SELECT_COLUMNS)
        .eq('id', existing.id)
        .single();
      return ok({ contact: data, outcome: 'matched' }, 200);
    }

    const ownerId = await resolveApiOwnerId(ctx.supabase, ctx.accountId, ctx.createdBy);
    if (!ownerId) throw badRequest('Could not determine an owner for this account');

    const statusId = typeof body?.statusId === 'string' ? body.statusId : null;
    const leadOriginId = typeof body?.leadOriginId === 'string' ? body.leadOriginId : null;

    const { data, error } = await ctx.supabase
      .from('contacts')
      .insert({
        account_id: ctx.accountId,
        user_id: ownerId,
        phone,
        name: typeof body?.name === 'string' ? body.name.trim() || null : null,
        email: typeof body?.email === 'string' ? body.email.trim() || null : null,
        company: typeof body?.company === 'string' ? body.company.trim() || null : null,
        status_id: statusId,
        lead_origin_id: leadOriginId,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        // Racing insert for the same phone — look it up rather than fail.
        const retried = await findExistingContact(ctx.supabase, ctx.accountId, phone);
        if (retried) {
          const { data: data2 } = await ctx.supabase
            .from('contacts')
            .select(SELECT_COLUMNS)
            .eq('id', retried.id)
            .single();
          return ok({ contact: data2, outcome: 'matched' }, 200);
        }
      }
      console.error('[POST /api/v1/contacts] insert error:', error.message);
      throw error;
    }

    return ok({ contact: data, outcome: 'created' }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
