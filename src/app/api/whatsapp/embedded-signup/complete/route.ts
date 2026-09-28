import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { createWhatsAppChannel, toCreateChannelErrorResponse } from '@/lib/whatsapp/create-channel'
import {
  deleteEmbeddedSignupSession,
  getEmbeddedSignupSession,
} from '@/lib/whatsapp/embedded-signup-session'

/**
 * POST /api/whatsapp/embedded-signup/complete
 *
 * Final step of the Embedded Signup flow: the user picked a WABA + phone
 * number on /whatsapp-connect. Generates a random 2FA PIN and webhook
 * verify_token (the manual flow has the user type these in; here nobody
 * ever needs to see them except once, in the success response) and reuses
 * createWhatsAppChannel() — the same limit/collision/verification/
 * registration logic the manual form goes through.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json()
    const { session: sessionId, wabaId, phoneNumberId, name } = body as {
      session?: string
      wabaId?: string
      phoneNumberId?: string
      name?: string
    }

    if (!sessionId || !wabaId || !phoneNumberId) {
      return NextResponse.json({ error: 'session, wabaId and phoneNumberId are required' }, { status: 400 })
    }

    const session = await getEmbeddedSignupSession(sessionId)
    if (!session || session.accountId !== accountId) {
      return NextResponse.json(
        { error: 'Sessão expirada ou inválida. Feche esta janela e tente novamente.' },
        { status: 410 },
      )
    }

    const waba = session.wabas.find((w) => w.id === wabaId)
    const phone = waba?.phoneNumbers.find((p) => p.id === phoneNumberId)
    if (!waba || !phone) {
      return NextResponse.json({ error: 'Número não encontrado nesta sessão.' }, { status: 400 })
    }

    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const verifyToken = crypto.randomBytes(24).toString('hex')

    const result = await createWhatsAppChannel({
      supabase,
      accountId,
      userId,
      name: name?.trim() || phone.verified_name || phone.display_phone_number,
      phoneNumberId: phone.id,
      wabaId: waba.id,
      accessToken: session.longLivedToken,
      verifyToken,
      pin,
      displayPhoneNumberOverride: phone.display_phone_number,
    })

    await deleteEmbeddedSignupSession(sessionId).catch(() => {})

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
