import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getEmbeddedSignupSession } from '@/lib/whatsapp/embedded-signup-session'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/whatsapp/embedded-signup/session/[id]
 *
 * Read by /whatsapp-connect to render the WABA/number picker. Never
 * returns the long-lived access token — only WABA/number metadata, plus
 * an `alreadyConnected` flag per number computed against this account's
 * existing whatsapp_channels rows.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { accountId, supabase } = await requireRole('admin')

    const session = await getEmbeddedSignupSession(id)
    if (!session || session.accountId !== accountId) {
      return NextResponse.json(
        { error: 'Sessão expirada ou inválida. Feche esta janela e tente novamente.' },
        { status: 410 },
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_channels')
      .select('phone_number_id')
      .eq('account_id', accountId)
    const connectedIds = new Set((existing ?? []).map((r) => r.phone_number_id))

    return NextResponse.json({
      wabas: session.wabas.map((w) => ({
        ...w,
        phoneNumbers: w.phoneNumbers.map((p) => ({
          ...p,
          alreadyConnected: connectedIds.has(p.id),
        })),
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
