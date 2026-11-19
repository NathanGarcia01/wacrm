import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/routing/admin-client'

/**
 * PATCH /api/settings/opt-out/keywords
 *
 * Fase 2 (Radar) — produto: replaces the direct client-side
 * `supabase.from('accounts').update(...)` that
 * opt-out-keywords-settings.tsx used to do for BOTH fields
 * (broadcast_optout_keywords and broadcast_optout_enforced). Routed
 * through a server endpoint now so a keyword-list change can be
 * audited (optout_keywords_audit_log, migration 136) — something a
 * direct RLS-scoped client write can't do on its own, since writing
 * the audit row needs service_role (no INSERT policy for
 * authenticated, same pattern as every other audit table in this
 * codebase).
 *
 * Body: { keywords?: string[], enforced?: boolean } — at least one.
 * `enforced` no longer gates whether a block is respected at send
 * time (that's unconditional now — see broadcasts/cron,
 * use-broadcast-sending, marketing-template-guard); it only decides
 * whether a confirmation reply goes out when a block is captured.
 *
 * The audit row is only written when `keywords` is actually
 * provided and differs from the current value — toggling `enforced`
 * alone, or saving the same list unchanged, logs nothing (per the
 * ask: audit keyword LIST changes, not the enforced toggle).
 */
export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const keywords = body.keywords as string[] | undefined
    const enforced = body.enforced as boolean | undefined
    if (keywords === undefined && enforced === undefined) {
      return NextResponse.json({ error: 'keywords or enforced is required' }, { status: 400 })
    }
    if (keywords !== undefined && (!Array.isArray(keywords) || keywords.some((k) => typeof k !== 'string'))) {
      return NextResponse.json({ error: 'keywords deve ser uma lista de strings' }, { status: 400 })
    }

    const admin = supabaseAdmin()

    const { data: current, error: currentError } = await admin
      .from('accounts')
      .select('broadcast_optout_keywords, broadcast_optout_enforced')
      .eq('id', accountId)
      .maybeSingle()
    if (currentError) {
      console.error('[PATCH /api/settings/opt-out/keywords] load current error:', currentError)
      return NextResponse.json({ error: 'Failed to load current settings' }, { status: 500 })
    }
    const currentKeywords = (current?.broadcast_optout_keywords as string[] | null) ?? []

    const { error: updateError } = await admin
      .from('accounts')
      .update({
        ...(keywords !== undefined ? { broadcast_optout_keywords: keywords } : {}),
        ...(enforced !== undefined ? { broadcast_optout_enforced: enforced } : {}),
      })
      .eq('id', accountId)
    if (updateError) {
      console.error('[PATCH /api/settings/opt-out/keywords] update error:', updateError)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    const keywordsChanged =
      keywords !== undefined &&
      (keywords.length !== currentKeywords.length || keywords.some((k, i) => k !== currentKeywords[i]))
    if (keywordsChanged) {
      const { error: auditError } = await admin.from('optout_keywords_audit_log').insert({
        account_id: accountId,
        changed_by: userId,
        keywords_before: currentKeywords,
        keywords_after: keywords,
      })
      // Best-effort — same convention as every other audit write in
      // this codebase (e.g. ticket_events): a logging failure must
      // never undo or block the actual settings save, which already
      // succeeded above.
      if (auditError) {
        console.error('[PATCH /api/settings/opt-out/keywords] audit insert error:', auditError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
