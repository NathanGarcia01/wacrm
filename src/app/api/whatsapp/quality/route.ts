import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Surfaces the WhatsApp number's `quality_rating` for the broadcast
 * Send step's anti-ban badge. A dedicated route (rather than calling
 * Meta from the client) because the access token only ever gets
 * decrypted server-side.
 */
export async function GET() {
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

  const { data: config, error: configError } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .single()

  if (configError || !config) {
    return NextResponse.json(
      { error: 'WhatsApp not configured.' },
      { status: 400 },
    )
  }

  try {
    const accessToken = decrypt(config.access_token)
    const info = await verifyPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })
    return NextResponse.json({ quality_rating: info.quality_rating ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
