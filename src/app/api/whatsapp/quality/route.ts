import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { resolveChannelById } from '@/lib/whatsapp/channels'

/**
 * Surfaces a WhatsApp number's `quality_rating` (used by the broadcast
 * Send step's anti-ban badge) plus `messaging_limit_tier` and
 * `display_phone_number` (used by the Reports Quality tab). A dedicated
 * route (rather than calling Meta from the client) because the access
 * token only ever gets decrypted server-side.
 *
 * Accepts an optional `?channel_id=` — the broadcast wizard passes the
 * number the user picked in step 4 so the quality badge reflects that
 * channel specifically. Omitted (or invalid), falls back to the
 * account's default channel.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const channelId = searchParams.get('channel_id')

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const config = await resolveChannelById(supabase, channelId, accountId)

  if (!config) {
    return NextResponse.json(
      { error: 'WhatsApp not configured.' },
      { status: 400 },
    )
  }

  try {
    const info = await verifyPhoneNumber({
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
    })
    return NextResponse.json({
      quality_rating: info.quality_rating ?? null,
      messaging_limit_tier: info.messaging_limit_tier ?? null,
      display_phone_number: info.display_phone_number ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
