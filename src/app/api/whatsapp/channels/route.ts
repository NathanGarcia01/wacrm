import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { createWhatsAppChannel, toCreateChannelErrorResponse } from '@/lib/whatsapp/create-channel'

/**
 * GET /api/whatsapp/channels
 *
 * Lists every WhatsApp channel on the caller's account. No token
 * decryption here — the list view only needs metadata, and Meta
 * verification happens at create/edit time, not on every list load.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('whatsapp_channels')
      .select(
        'id, name, phone_number_id, waba_id, display_phone_number, is_active, is_default, registered_at, last_registration_error, created_at, channel_type, evolution_status',
      )
      .eq('account_id', accountId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching whatsapp_channels:', error)
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
    }

    return NextResponse.json({
      channels: (data ?? []).map((row) => ({
        ...row,
        registered: row.registered_at != null,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/whatsapp/channels
 *
 * Creates a new WhatsApp channel for the caller's account. Verifies
 * credentials with Meta first, then encrypts and stores — same sequence
 * as the legacy singleton in src/app/api/whatsapp/config/route.ts, just
 * inserting a new row instead of upserting the account's one row.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const {
      name,
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      display_phone_number: displayPhoneNumberOverride,
      is_default: requestedDefault,
    } = body

    if (!name?.trim() || !phone_number_id || !access_token) {
      return NextResponse.json(
        { error: 'name, phone_number_id and access_token are required' },
        { status: 400 },
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json({ error: 'PIN must be exactly 6 digits.' }, { status: 400 })
      }
    }

    const result = await createWhatsAppChannel({
      supabase,
      accountId,
      userId,
      name,
      phoneNumberId: phone_number_id,
      wabaId: waba_id || null,
      accessToken: access_token,
      verifyToken: verify_token || null,
      pin: pin || null,
      displayPhoneNumberOverride,
      requestedDefault,
    })

    return NextResponse.json({
      success: true,
      channel: result.channel,
      registration_error: result.registrationError,
      phone_info: result.phoneInfo,
    })
  } catch (err) {
    return toCreateChannelErrorResponse(err)
  }
}
