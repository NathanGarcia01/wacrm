import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getEvolutionConnectionState } from '@/lib/whatsapp/evolution-client'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/whatsapp/channels/[id]/evolution-status
 *
 * Polled every few seconds by the QR-pairing dialog, and on-demand by
 * the channel list's status badge. Syncs whatsapp_channels.evolution_status
 * to whatever Evolution currently reports so both surfaces (and any
 * other account member's tab) see the same state without each holding
 * its own polling loop's-worth of drift.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, accountId } = await getCurrentAccount()

    const { data: channel, error } = await supabase
      .from('whatsapp_channels')
      .select('id, channel_type, evolution_instance_name, evolution_status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[evolution-status] fetch failed:', error)
      return NextResponse.json({ error: 'Failed to load channel' }, { status: 500 })
    }
    if (!channel || channel.channel_type !== 'evolution' || !channel.evolution_instance_name) {
      return NextResponse.json({ error: 'Not an Evolution channel' }, { status: 404 })
    }

    let state: 'open' | 'connecting' | 'close'
    try {
      state = await getEvolutionConnectionState(channel.evolution_instance_name)
    } catch (err) {
      // Evolution unreachable/instance gone — degrade to "close" rather
      // than 500ing the poll. The reconnect button lets the user
      // recover by generating a fresh instance/QR.
      console.error(
        '[evolution-status] getConnectionState failed:',
        err instanceof Error ? err.message : err,
      )
      state = 'close'
    }

    if (state !== channel.evolution_status) {
      const { error: updateError } = await supabase
        .from('whatsapp_channels')
        .update({ evolution_status: state, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (updateError) {
        console.error('[evolution-status] failed to persist status:', updateError)
      }
    }

    return NextResponse.json({ evolution_status: state })
  } catch (err) {
    return toErrorResponse(err)
  }
}
