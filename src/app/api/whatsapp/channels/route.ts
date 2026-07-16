import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'

// Lazy-initialised service-role client. Needed to detect a phone_number_id
// already claimed by a *different* account — under RLS, the caller's own
// session can't see other accounts' rows, so the conflict would be
// invisible without the service role. Mirrors the identical pattern in
// src/app/api/whatsapp/config/route.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

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
        'id, name, phone_number_id, waba_id, display_phone_number, is_active, is_default, registered_at, last_registration_error, created_at',
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

    // Reject if another account already claimed this phone_number_id —
    // same anti-collision rationale as whatsapp_config (issue #136): two
    // accounts sharing a number breaks the webhook's channel lookup.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_channels')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json({ error: 'Failed to validate channel' }, { status: 500 })
    }
    if (claimed) {
      return NextResponse.json(
        {
          error:
            'Este número do WhatsApp já está vinculado a outra conta. Cada número só pode ser conectado a uma conta Funilly.',
        },
        { status: 409 },
      )
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId: phone_number_id, accessToken: access_token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 },
      )
    }

    // Step 1: register the phone number for inbound webhooks (best-effort,
    // same PIN semantics as whatsapp_config — see that route's comments).
    let registeredAt: string | null = null
    let registrationError: string | null = null
    if (pin) {
      try {
        await registerPhoneNumber({ phoneNumberId: phone_number_id, accessToken: access_token, pin })
        registeredAt = new Date().toISOString()
      } catch (err) {
        registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('Phone number /register failed:', registrationError)
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's side.
    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({ wabaId: waba_id, accessToken: access_token })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        console.warn(
          'WABA subscribed_apps failed (non-fatal):',
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    // The very first channel on an account is always the default —
    // otherwise honor what the caller asked for.
    const { count: existingChannelCount } = await supabase
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    const isDefault = existingChannelCount === 0 || requestedDefault === true

    if (isDefault) {
      // Only one default per account — clear the others first. Sequential
      // (not a single transaction) because supabase-js has no multi-
      // statement transaction API; both updates are scoped to this
      // account so a crash between them just leaves zero defaults, which
      // resolveDefaultChannel() tolerates.
      const { error: unsetError } = await supabase
        .from('whatsapp_channels')
        .update({ is_default: false })
        .eq('account_id', accountId)
      if (unsetError) {
        console.error('Error clearing previous default channel:', unsetError)
        return NextResponse.json({ error: 'Failed to save channel' }, { status: 500 })
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_channels')
      .insert({
        account_id: accountId,
        name: name.trim(),
        phone_number_id,
        waba_id: waba_id || null,
        access_token_encrypted: encryptedAccessToken,
        display_phone_number: displayPhoneNumberOverride || phoneInfo.display_phone_number || null,
        is_active: true,
        is_default: isDefault,
        verify_token: encryptedVerifyToken,
        registered_at: registeredAt,
        subscribed_apps_at: subscribedAppsAt,
        last_registration_error: registrationError,
        created_by: userId,
      })
      .select(
        'id, name, phone_number_id, waba_id, display_phone_number, is_active, is_default, registered_at, last_registration_error, created_at',
      )
      .single()

    if (insertError) {
      console.error('Error inserting whatsapp_channels row:', insertError)
      return NextResponse.json({ error: 'Failed to save channel' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      channel: { ...inserted, registered: inserted.registered_at != null },
      registration_error: registrationError,
      phone_info: phoneInfo,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
