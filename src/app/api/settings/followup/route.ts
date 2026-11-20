import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

const DEFAULT_MAX_PER_DAY = 50

/**
 * GET /api/settings/followup
 *
 * Fase 2 (Follow-up seguro) — B3. Leitura liberada pra qualquer membro
 * da conta (mesmo padrão de GET /api/settings/radar); só a escrita
 * exige admin+ e plano com hasFollowup.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const [{ data: settings, error }, features] = await Promise.all([
      supabase.from('followup_settings').select('max_per_day').eq('account_id', accountId).maybeSingle(),
      getAccountPlanFeatures(supabase, accountId),
    ])
    if (error) {
      console.error('[GET /api/settings/followup] load error:', error)
      return NextResponse.json({ error: 'Failed to load follow-up settings' }, { status: 500 })
    }

    return NextResponse.json({
      maxPerDay: settings?.max_per_day ?? DEFAULT_MAX_PER_DAY,
      hasFollowup: features.hasFollowup,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/settings/followup
 *
 * Body: { maxPerDay: number }
 *
 * Admin+ e plano com hasFollowup. Escrita via supabaseAdmin()
 * (service_role) — followup_settings não tem policy de INSERT/UPDATE
 * para `authenticated` (migration 137).
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json()
    const maxPerDay = body.maxPerDay as number | undefined
    if (maxPerDay === undefined || !Number.isInteger(maxPerDay) || maxPerDay <= 0) {
      return NextResponse.json({ error: 'maxPerDay deve ser um número inteiro maior que 0' }, { status: 400 })
    }

    const features = await getAccountPlanFeatures(supabase, accountId)
    if (!features.hasFollowup) {
      return NextResponse.json(
        { error: 'O Follow-up não está disponível no seu plano atual. Faça upgrade para o plano Pro ou Business.' },
        { status: 403 },
      )
    }

    const admin = supabaseAdmin()
    const { error: upsertError } = await admin.from('followup_settings').upsert({
      account_id: accountId,
      max_per_day: maxPerDay,
      updated_at: new Date().toISOString(),
    })
    if (upsertError) {
      console.error('[PATCH /api/settings/followup] upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to save follow-up settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
