import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { createWhatsAppChannel, toCreateChannelErrorResponse } from '@/lib/whatsapp/create-channel'
import { exchangeCodeForUserToken, exchangeForLongLivedToken } from '@/lib/whatsapp/embedded-signup'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/embedded-signup/complete
 *
 * Final step of the Embedded Signup flow: the Facebook JS SDK popup
 * (FB.login with config_id) already let the user pick a WABA + phone
 * number — we get those straight from the WA_EMBEDDED_SIGNUP postMessage
 * event, no picker step of our own needed. Trades the OAuth `code` for a
 * token, then reuses createWhatsAppChannel() — the same limit/collision/
 * verification/registration logic the manual form goes through.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json()
    const { code, wabaId, phoneNumberId, name } = body as {
      code?: string
      wabaId?: string
      phoneNumberId?: string
      name?: string
    }

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json(
        { error: 'code, wabaId e phoneNumberId são obrigatórios' },
        { status: 400 },
      )
    }

    const shortLived = await exchangeCodeForUserToken(code)
    const longLived = await exchangeForLongLivedToken(shortLived.accessToken)
    const phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken: longLived.accessToken })

    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const verifyToken = crypto.randomBytes(24).toString('hex')

    const result = await createWhatsAppChannel({
      supabase,
      accountId,
      userId,
      name: name?.trim() || phoneInfo.verified_name || phoneInfo.display_phone_number || phoneNumberId,
      phoneNumberId,
      wabaId,
      accessToken: longLived.accessToken,
      verifyToken,
      pin,
      displayPhoneNumberOverride: phoneInfo.display_phone_number,
    })

    return NextResponse.json({
      success: true,
      channel: result.channel,
      registration_error: result.registrationError,
      pin,
    })
  } catch (err) {
    return toCreateChannelErrorResponse(err)
  }
}
