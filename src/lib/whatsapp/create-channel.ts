/**
 * Shared "create a whatsapp_channels row" logic — the limit check,
 * cross-account collision check, Meta verification, encryption, best-effort
 * webhook registration, and is_default bookkeeping that both the manual
 * "Cloud API" form (POST /api/whatsapp/channels) and the Embedded Signup
 * "complete" step need identically. Extracted so the two callers can never
 * drift apart on this sequence.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from './meta-api'
import { encrypt } from './encryption'
import { checkChannelLimit } from '@/lib/billing/server'
import { toErrorResponse } from '@/lib/auth/account'

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

export class ChannelLimitError extends Error {
  readonly status = 403 as const
}
export class ChannelCollisionError extends Error {
  readonly status = 409 as const
}
export class ChannelValidationError extends Error {
  readonly status = 400 as const
}
export class ChannelPersistError extends Error {
  readonly status = 500 as const
}

export interface CreateChannelInput {
  /** RLS-scoped client from requireRole(). */
  supabase: SupabaseClient
  accountId: string
  userId: string
  name: string
  phoneNumberId: string
  wabaId: string | null
  accessToken: string
  verifyToken: string | null
  pin: string | null
  displayPhoneNumberOverride?: string | null
  requestedDefault?: boolean
}

export interface CreateChannelResultChannel {
  id: string
  name: string
  phone_number_id: string
  waba_id: string | null
  display_phone_number: string | null
  is_active: boolean
  is_default: boolean
  registered_at: string | null
  last_registration_error: string | null
  created_at: string
  registered: boolean
}

export interface CreateChannelResult {
  channel: CreateChannelResultChannel
  registrationError: string | null
  phoneInfo: MetaPhoneInfo
}

/**
 * Creates a whatsapp_channels row, verifying credentials with Meta first
 * and best-effort registering the number/WABA for inbound webhooks. Throws
 * one of the typed errors above on a known failure mode — callers should
 * catch with toCreateChannelErrorResponse().
 */
export async function createWhatsAppChannel(input: CreateChannelInput): Promise<CreateChannelResult> {
  const {
    supabase,
    accountId,
    userId,
    name,
    phoneNumberId,
    wabaId,
    accessToken,
    verifyToken,
    pin,
    displayPhoneNumberOverride,
    requestedDefault,
  } = input

  // Plan gate — checked before the Meta verification call below so a
  // maxed-out account doesn't burn a Graph API round trip just to be
  // rejected anyway.
  const channelLimit = await checkChannelLimit(supabase, accountId)
  if (!channelLimit.allowed) {
    throw new ChannelLimitError(channelLimit.error)
  }

  // Reject if another account already claimed this phone_number_id — two
  // accounts sharing a number breaks the webhook's channel lookup.
  const { data: claimed, error: claimedError } = await supabaseAdmin()
    .from('whatsapp_channels')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()

  if (claimedError) {
    console.error('Error checking phone_number_id ownership:', claimedError)
    throw new ChannelPersistError('Failed to validate channel')
  }
  if (claimed) {
    throw new ChannelCollisionError(
      'Este número do WhatsApp já está vinculado a outra conta. Cada número só pode ser conectado a uma conta Funilly.',
    )
  }

  let phoneInfo: MetaPhoneInfo
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    throw new ChannelValidationError(`Meta API error: ${message}`)
  }

  let encryptedAccessToken: string
  let encryptedVerifyToken: string | null
  try {
    encryptedAccessToken = encrypt(accessToken)
    encryptedVerifyToken = verifyToken ? encrypt(verifyToken) : null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown encryption error'
    console.error('Encryption failed:', message)
    throw new ChannelPersistError(
      'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
    )
  }

  // Step 1: register the phone number for inbound webhooks (best-effort).
  let registeredAt: string | null = null
  let registrationError: string | null = null
  if (pin) {
    try {
      await registerPhoneNumber({ phoneNumberId, accessToken, pin })
      registeredAt = new Date().toISOString()
    } catch (err) {
      registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Phone number /register failed:', registrationError)
    }
  }

  // Step 2: subscribe the WABA to this app. Idempotent on Meta's side.
  let subscribedAppsAt: string | null = null
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
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
    const { error: unsetError } = await supabase
      .from('whatsapp_channels')
      .update({ is_default: false })
      .eq('account_id', accountId)
    if (unsetError) {
      console.error('Error clearing previous default channel:', unsetError)
      throw new ChannelPersistError('Failed to save channel')
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('whatsapp_channels')
    .insert({
      account_id: accountId,
      name: name.trim(),
      phone_number_id: phoneNumberId,
      waba_id: wabaId || null,
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

  if (insertError || !inserted) {
    console.error('Error inserting whatsapp_channels row:', insertError)
    throw new ChannelPersistError('Failed to save channel')
  }

  return {
    channel: { ...inserted, registered: inserted.registered_at != null },
    registrationError,
    phoneInfo,
  }
}

/**
 * Maps the typed errors thrown by createWhatsAppChannel() to their HTTP
 * status. Falls back to toErrorResponse() (from requireRole()) for
 * UnauthorizedError/ForbiddenError/anything else.
 */
export function toCreateChannelErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof ChannelLimitError ||
    err instanceof ChannelCollisionError ||
    err instanceof ChannelValidationError ||
    err instanceof ChannelPersistError
  ) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  return toErrorResponse(err)
}
