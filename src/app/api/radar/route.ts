import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import { supabaseAdmin } from '@/lib/routing/admin-client'
import type { RadarConversation, RadarGroup } from '@/types'

const DEFAULT_WAITING_HOURS = 2
const DEFAULT_COOLED_HOURS = 24
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * GET /api/radar
 *
 * Fase 2 (Radar) — Etapa A. Única fonte de verdade sobre "o que este
 * chamador pode ver": a RPC get_radar_conversations não recebe papel
 * nem user_id (é service_role-only, revogada de authenticated — ver
 * migration 133) — esta rota resolve o escopo e passa já decidido.
 * Agente comum SEMPRE vê só as próprias (p_assigned_agent_id forçado
 * ao próprio id, ignora o query param); admin+ vê todas por padrão,
 * com filtro opcional por agente.
 *
 * Query params: group ('awaiting_us' | 'customer_cooled'), agentId
 * (admin+ apenas), minHours, limit, offset.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId, role } = await requireRole('agent')

    const features = await getAccountPlanFeatures(supabase, accountId)
    if (!features.hasFollowup) {
      return NextResponse.json(
        { error: 'O Radar não está disponível no seu plano atual. Faça upgrade para o plano Pro ou Business.' },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const groupParam = url.searchParams.get('group')
    const group: RadarGroup | null =
      groupParam === 'awaiting_us' || groupParam === 'customer_cooled' ? groupParam : null
    if (groupParam && !group) {
      return NextResponse.json({ error: 'group inválido' }, { status: 400 })
    }

    const isAdmin = hasMinRole(role, 'admin')
    const agentIdParam = url.searchParams.get('agentId')
    // Agente comum nunca escolhe — só admin+ pode filtrar por outro
    // agente (ou ver todos, omitindo o param).
    const assignedAgentId = isAdmin ? agentIdParam : userId

    const minHoursParam = url.searchParams.get('minHours')
    const minHours = minHoursParam ? Number(minHoursParam) : null
    if (minHoursParam && (!Number.isFinite(minHours) || (minHours as number) < 0)) {
      return NextResponse.json({ error: 'minHours inválido' }, { status: 400 })
    }

    const limitParam = url.searchParams.get('limit')
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitParam ? Number(limitParam) || DEFAULT_LIMIT : DEFAULT_LIMIT))
    const offsetParam = url.searchParams.get('offset')
    const offset = Math.max(0, offsetParam ? Number(offsetParam) || 0 : 0)

    const admin = supabaseAdmin()
    const { data: settings } = await admin
      .from('radar_settings')
      .select('waiting_hours, cooled_hours')
      .eq('account_id', accountId)
      .maybeSingle()

    const { data, error } = await admin.rpc('get_radar_conversations', {
      p_account_id: accountId,
      p_assigned_agent_id: assignedAgentId,
      p_group: group,
      p_min_hours: minHours,
      p_waiting_hours: settings?.waiting_hours ?? DEFAULT_WAITING_HOURS,
      p_cooled_hours: settings?.cooled_hours ?? DEFAULT_COOLED_HOURS,
      p_limit: limit,
      p_offset: offset,
    })
    if (error) {
      console.error('[GET /api/radar] rpc error:', error)
      return NextResponse.json({ error: 'Failed to load radar' }, { status: 500 })
    }

    const conversations = (data ?? []) as RadarConversation[]
    return NextResponse.json({
      conversations,
      // Página cheia = pode haver mais; cliente pede a próxima só se precisar.
      hasMore: conversations.length === limit,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
