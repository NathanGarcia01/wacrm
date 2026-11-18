import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import { supabaseAdmin } from '@/lib/routing/admin-client'
import type { RoutingMode } from '@/types'

const VALID_MODES: RoutingMode[] = ['manual', 'round_robin', 'load']

/**
 * GET /api/settings/routing
 *
 * Fase 1 (distribuição automática de tickets) — Etapa 2. Leitura
 * liberada para qualquer membro da conta (mesma visibilidade de
 * departments_select) — só a escrita (PATCH) exige admin+ e plano
 * com hasRouting.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const [{ data: settings, error }, features] = await Promise.all([
      supabase
        .from('routing_settings')
        .select('mode, enabled_at')
        .eq('account_id', accountId)
        .maybeSingle(),
      getAccountPlanFeatures(supabase, accountId),
    ])
    if (error) {
      console.error('[GET /api/settings/routing] load error:', error)
      return NextResponse.json({ error: 'Failed to load routing settings' }, { status: 500 })
    }

    return NextResponse.json({
      mode: (settings?.mode ?? 'manual') as RoutingMode,
      enabledAt: settings?.enabled_at ?? null,
      hasRouting: features.hasRouting,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/settings/routing
 *
 * Body: { mode: 'manual' | 'round_robin' | 'load' }
 *
 * `enabled_at` só é atualizado na transição manual -> não-manual
 * (regra 3 do ajuste): ligar round_robin/load pela primeira vez (ou
 * religar depois de ter voltado a manual) marca "a partir de agora",
 * nunca redistribuindo o backlog pendente que já existia. Trocar
 * entre round_robin e load, ou desligar (voltar a manual), não toca
 * enabled_at.
 *
 * Escrita via supabaseAdmin() (service_role) — routing_settings não
 * tem policy de INSERT/UPDATE para `authenticated` (migration 129);
 * o gate de admin+ e de plano acontece aqui, antes de chegar no
 * service-role client.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json()
    const mode = body.mode as RoutingMode
    if (!VALID_MODES.includes(mode)) {
      return NextResponse.json({ error: 'mode inválido' }, { status: 400 })
    }

    const features = await getAccountPlanFeatures(supabase, accountId)
    if (!features.hasRouting) {
      return NextResponse.json(
        {
          error:
            'Distribuição automática não está disponível no seu plano atual. Faça upgrade para o plano Pro ou Business.',
        },
        { status: 403 },
      )
    }

    const admin = supabaseAdmin()
    const { data: current, error: currentError } = await admin
      .from('routing_settings')
      .select('mode, enabled_at')
      .eq('account_id', accountId)
      .maybeSingle()
    if (currentError) {
      console.error('[PATCH /api/settings/routing] load current error:', currentError)
      return NextResponse.json({ error: 'Failed to load routing settings' }, { status: 500 })
    }

    const previousMode = (current?.mode ?? 'manual') as RoutingMode
    const enabledAt =
      mode !== 'manual' && previousMode === 'manual' ? new Date().toISOString() : current?.enabled_at ?? null

    const { error: upsertError } = await admin
      .from('routing_settings')
      .upsert({ account_id: accountId, mode, enabled_at: enabledAt, updated_at: new Date().toISOString() })
    if (upsertError) {
      console.error('[PATCH /api/settings/routing] upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to save routing settings' }, { status: 500 })
    }

    return NextResponse.json({ mode, enabledAt })
  } catch (err) {
    return toErrorResponse(err)
  }
}
