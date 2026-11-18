import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import { supabaseAdmin } from '@/lib/routing/admin-client'
import { isAccountRole } from '@/lib/auth/roles'

/** Defaults espelhados de routing_member_settings (migration 129) —
 *  membro sem linha usa estes valores. Mantidos aqui também (não só
 *  em src/lib/routing/cycle.ts) porque a tela precisa mostrá-los
 *  como valor atual antes de o admin salvar algo pela primeira vez. */
const DEFAULT_CAPACITY = 5
const DEFAULT_IS_ENABLED = true

interface MemberRoutingRow {
  userId: string
  fullName: string
  email: string
  role: string
  capacity: number
  isEnabled: boolean
}

/**
 * GET /api/settings/routing/members
 *
 * Lista todo membro da conta com sua capacidade/participação atual
 * (ou o default, se nunca configurado). Leitura liberada para
 * qualquer membro, mesmo padrão de GET /api/settings/routing.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const [{ data: profiles, error: profilesError }, { data: memberSettings, error: memberSettingsError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, full_name, email, account_role')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true }),
        supabase
          .from('routing_member_settings')
          .select('user_id, capacity, is_enabled')
          .eq('account_id', accountId),
      ])
    if (profilesError) {
      console.error('[GET /api/settings/routing/members] profiles error:', profilesError)
      return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
    }
    if (memberSettingsError) {
      console.error('[GET /api/settings/routing/members] settings error:', memberSettingsError)
      return NextResponse.json({ error: 'Failed to load member settings' }, { status: 500 })
    }

    const settingsByUser = new Map(
      (memberSettings ?? []).map((r) => [r.user_id as string, { capacity: r.capacity as number, isEnabled: r.is_enabled as boolean }]),
    )

    const members: MemberRoutingRow[] = (profiles ?? []).flatMap((p) => {
      if (!isAccountRole(p.account_role)) return []
      const settings = settingsByUser.get(p.user_id as string)
      return [
        {
          userId: p.user_id as string,
          fullName: (p.full_name as string | null) || (p.email as string) || '',
          email: p.email as string,
          role: p.account_role as string,
          capacity: settings?.capacity ?? DEFAULT_CAPACITY,
          isEnabled: settings?.isEnabled ?? DEFAULT_IS_ENABLED,
        },
      ]
    })

    return NextResponse.json({ members })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/settings/routing/members
 *
 * Body: { userId: string, capacity?: number, isEnabled?: boolean }
 *
 * Admin+ e plano com hasRouting, mesmo gate de
 * PATCH /api/settings/routing. Valida que `userId` pertence à mesma
 * conta do chamador antes de gravar — sem isso um admin poderia
 * tentar alterar a capacidade de um membro de outra conta.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json()
    const userId = body.userId as string | undefined
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const capacity = body.capacity as number | undefined
    const isEnabled = body.isEnabled as boolean | undefined
    if (capacity === undefined && isEnabled === undefined) {
      return NextResponse.json({ error: 'capacity or isEnabled is required' }, { status: 400 })
    }
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
      return NextResponse.json({ error: 'capacity deve ser um inteiro >= 1' }, { status: 400 })
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

    const { data: targetProfile, error: targetError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (targetError) {
      console.error('[PATCH /api/settings/routing/members] target lookup error:', targetError)
      return NextResponse.json({ error: 'Failed to load member' }, { status: 500 })
    }
    if (!targetProfile) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const admin = supabaseAdmin()
    const { data: current } = await admin
      .from('routing_member_settings')
      .select('capacity, is_enabled')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .maybeSingle()

    const { error: upsertError } = await admin.from('routing_member_settings').upsert({
      account_id: accountId,
      user_id: userId,
      capacity: capacity ?? current?.capacity ?? DEFAULT_CAPACITY,
      is_enabled: isEnabled ?? current?.is_enabled ?? DEFAULT_IS_ENABLED,
      updated_at: new Date().toISOString(),
    })
    if (upsertError) {
      console.error('[PATCH /api/settings/routing/members] upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to save member settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
