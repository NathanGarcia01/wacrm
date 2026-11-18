import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import { supabaseAdmin } from '@/lib/routing/admin-client'

const DEFAULT_WAITING_HOURS = 2
const DEFAULT_COOLED_HOURS = 24

/**
 * GET /api/settings/radar
 *
 * Fase 2 (Radar) — Etapa A. Leitura liberada para qualquer membro da
 * conta (mesmo padrão de GET /api/settings/routing); só a escrita
 * exige admin+ e plano com hasFollowup.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const [{ data: settings, error }, features] = await Promise.all([
      supabase
        .from('radar_settings')
        .select('waiting_hours, cooled_hours')
        .eq('account_id', accountId)
        .maybeSingle(),
      getAccountPlanFeatures(supabase, accountId),
    ])
    if (error) {
      console.error('[GET /api/settings/radar] load error:', error)
      return NextResponse.json({ error: 'Failed to load radar settings' }, { status: 500 })
    }

    return NextResponse.json({
      waitingHours: settings?.waiting_hours ?? DEFAULT_WAITING_HOURS,
      cooledHours: settings?.cooled_hours ?? DEFAULT_COOLED_HOURS,
      hasFollowup: features.hasFollowup,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/settings/radar
 *
 * Body: { waitingHours?: number, cooledHours?: number }
 *
 * Admin+ e plano com hasFollowup. Escrita via supabaseAdmin()
 * (service_role) — radar_settings não tem policy de INSERT/UPDATE
 * para `authenticated` (migration 133).
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json()
    const waitingHours = body.waitingHours as number | undefined
    const cooledHours = body.cooledHours as number | undefined
    if (waitingHours === undefined && cooledHours === undefined) {
      return NextResponse.json({ error: 'waitingHours or cooledHours is required' }, { status: 400 })
    }
    if (waitingHours !== undefined && !(waitingHours > 0)) {
      return NextResponse.json({ error: 'waitingHours deve ser maior que 0' }, { status: 400 })
    }
    if (cooledHours !== undefined && !(cooledHours > 0)) {
      return NextResponse.json({ error: 'cooledHours deve ser maior que 0' }, { status: 400 })
    }

    const features = await getAccountPlanFeatures(supabase, accountId)
    if (!features.hasFollowup) {
      return NextResponse.json(
        { error: 'O Radar não está disponível no seu plano atual. Faça upgrade para o plano Pro ou Business.' },
        { status: 403 },
      )
    }

    const admin = supabaseAdmin()
    const { data: current } = await admin
      .from('radar_settings')
      .select('waiting_hours, cooled_hours')
      .eq('account_id', accountId)
      .maybeSingle()

    const { error: upsertError } = await admin.from('radar_settings').upsert({
      account_id: accountId,
      waiting_hours: waitingHours ?? current?.waiting_hours ?? DEFAULT_WAITING_HOURS,
      cooled_hours: cooledHours ?? current?.cooled_hours ?? DEFAULT_COOLED_HOURS,
      updated_at: new Date().toISOString(),
    })
    if (upsertError) {
      console.error('[PATCH /api/settings/radar] upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to save radar settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
