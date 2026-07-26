import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getEvolutionQrCode } from '@/lib/whatsapp/evolution-client'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/whatsapp/channels/[id]/evolution-qrcode
 *
 * Regenerates the pairing QR for an existing Evolution channel —
 * either the initial dialog's "gerar novo QR Code" after the 2-minute
 * timeout, or the channel list's "Reconectar" button for a channel
 * that later dropped to close/disconnected.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, accountId } = await requireRole('admin')

    const { data: channel, error } = await supabase
      .from('whatsapp_channels')
      .select('id, channel_type, evolution_instance_name')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[evolution-qrcode] fetch failed:', error)
      return NextResponse.json({ error: 'Failed to load channel' }, { status: 500 })
    }
    if (!channel || channel.channel_type !== 'evolution' || !channel.evolution_instance_name) {
      return NextResponse.json({ error: 'Not an Evolution channel' }, { status: 404 })
    }

    let qrCode: string | null
    try {
      const qr = await getEvolutionQrCode(channel.evolution_instance_name)
      qrCode = qr.base64
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
      console.error('[evolution-qrcode] getQrCode failed:', message)
      return NextResponse.json({ error: `Evolution API error: ${message}` }, { status: 502 })
    }

    await supabase
      .from('whatsapp_channels')
      .update({ evolution_status: 'connecting', updated_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ qr_code_base64: qrCode })
  } catch (err) {
    return toErrorResponse(err)
  }
}
