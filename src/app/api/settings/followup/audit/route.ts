import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAccountPlanFeatures } from '@/lib/billing/server'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * GET /api/settings/followup/audit
 *
 * Fase 2 (Follow-up seguro) — B3. Lista paginada de
 * followup_dispatch_log (sent/skipped+reason) pra admin+ — mesma
 * tela que a tela de Configurações embute, mesmo padrão de paginação
 * de GET /api/radar (limit/offset, hasMore = página cheia).
 *
 * Usa o client RLS-scoped (não supabaseAdmin) de propósito —
 * followup_dispatch_log já tem a policy de SELECT certa
 * (is_account_member(account_id, 'admin'), migration 137), então o
 * banco reforça o mesmo admin+ que requireRole já checou, em vez de
 * confiar só na checagem da rota.
 *
 * Query params: mode ('live' | 'dry_run'), conversationId, limit, offset.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const features = await getAccountPlanFeatures(supabase, accountId)
    if (!features.hasFollowup) {
      return NextResponse.json(
        { error: 'O Follow-up não está disponível no seu plano atual. Faça upgrade para o plano Pro ou Business.' },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const modeParam = url.searchParams.get('mode')
    const mode = modeParam === 'live' || modeParam === 'dry_run' ? modeParam : null
    if (modeParam && !mode) {
      return NextResponse.json({ error: 'mode inválido' }, { status: 400 })
    }
    const conversationId = url.searchParams.get('conversationId')

    const limitParam = url.searchParams.get('limit')
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitParam ? Number(limitParam) || DEFAULT_LIMIT : DEFAULT_LIMIT))
    const offsetParam = url.searchParams.get('offset')
    const offset = Math.max(0, offsetParam ? Number(offsetParam) || 0 : 0)

    let query = supabase
      .from('followup_dispatch_log')
      .select('id, conversation_id, contact_id, automation_id, flow_id, outcome, reason, mode, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (mode) query = query.eq('mode', mode)
    if (conversationId) query = query.eq('conversation_id', conversationId)

    const { data, error } = await query
    if (error) {
      console.error('[GET /api/settings/followup/audit] load error:', error)
      return NextResponse.json({ error: 'Failed to load follow-up audit' }, { status: 500 })
    }

    const rows = data ?? []
    return NextResponse.json({
      rows,
      // Página cheia = pode haver mais; cliente pede a próxima só se precisar.
      hasMore: rows.length === limit,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
