// ============================================================
// GET /api/account/lead-sources/[id]/events — "Últimos recebimentos".
//
// Last 20 receipts for one source (success and error alike), newest
// first. Any member can view — read-only, same bar as the roster GET.
// `lead_source_events` has a SELECT RLS policy for members, so this
// goes through the normal RLS-scoped client, not supabaseAdmin().
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const EVENTS_LIMIT = 20;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    // Confirm the source belongs to this account before returning its
    // events — RLS already scopes `lead_source_events` by account_id,
    // but this makes "wrong id" 404 instead of an empty-but-ambiguous list.
    const { data: source } = await ctx.supabase
      .from('lead_sources')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!source) {
      return NextResponse.json({ error: 'Fonte não encontrada' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('lead_source_events')
      .select('id, status, contact_outcome, deal_outcome, error_message, payload_summary, created_at')
      .eq('lead_source_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(EVENTS_LIMIT);

    if (error) {
      console.error('[GET /api/account/lead-sources/[id]/events] error:', error);
      return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
    }

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
