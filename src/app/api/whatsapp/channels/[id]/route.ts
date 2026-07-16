import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * PATCH /api/whatsapp/channels/[id]
 *
 * Edits an existing channel: name, active/inactive, default toggle, and
 * optional credential rotation (re-verifies with Meta + re-runs
 * /register + /subscribed_apps, same as a fresh POST).
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, accountId } = await requireRole('admin')

    const { data: existing, error: existingError } = await supabase
      .from('whatsapp_channels')
      .select('id, phone_number_id, waba_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (existingError) {
      console.error('Error fetching whatsapp_channels row:', existingError)
      return NextResponse.json({ error: 'Failed to load channel' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      name,
      is_active,
      is_default: requestedDefault,
      waba_id,
      access_token,
      verify_token,
      pin,
    } = body

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json({ error: 'PIN must be exactly 6 digits.' }, { status: 400 })
      }
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof name === 'string' && name.trim()) update.name = name.trim()
    if (typeof is_active === 'boolean') update.is_active = is_active
    if (waba_id !== undefined) update.waba_id = waba_id || null

    let phoneInfo: { display_phone_number: string } | null = null

    // Credential rotation — same verify → encrypt → register → subscribe
    // sequence as creating a channel, since a rotated token needs the
    // same Meta-side confirmation a brand-new one does.
    if (typeof access_token === 'string' && access_token.trim()) {
      try {
        phoneInfo = await verifyPhoneNumber({
          phoneNumberId: existing.phone_number_id,
          accessToken: access_token,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Meta API error'
        return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
      }

      try {
        update.access_token_encrypted = encrypt(access_token)
        if (verify_token) update.verify_token = encrypt(verify_token)
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

      if (pin) {
        try {
          await registerPhoneNumber({
            phoneNumberId: existing.phone_number_id,
            accessToken: access_token,
            pin,
          })
          update.registered_at = new Date().toISOString()
          update.last_registration_error = null
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', message)
          update.last_registration_error = message
        }
      }

      const effectiveWabaId = (waba_id !== undefined ? waba_id : existing.waba_id) || null
      if (effectiveWabaId) {
        try {
          await subscribeWabaToApp({ wabaId: effectiveWabaId, accessToken: access_token })
          update.subscribed_apps_at = new Date().toISOString()
        } catch (err) {
          console.warn(
            'WABA subscribed_apps failed (non-fatal):',
            err instanceof Error ? err.message : String(err),
          )
        }
      }

      if (phoneInfo?.display_phone_number) {
        update.display_phone_number = phoneInfo.display_phone_number
      }
    }

    if (requestedDefault === true) {
      // Only one default per account — clear the others first.
      const { error: unsetError } = await supabase
        .from('whatsapp_channels')
        .update({ is_default: false })
        .eq('account_id', accountId)
      if (unsetError) {
        console.error('Error clearing previous default channel:', unsetError)
        return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 })
      }
      update.is_default = true
    } else if (requestedDefault === false) {
      update.is_default = false
    }

    const { data: updated, error: updateError } = await supabase
      .from('whatsapp_channels')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(
        'id, name, phone_number_id, waba_id, display_phone_number, is_active, is_default, registered_at, last_registration_error, created_at',
      )
      .single()

    if (updateError) {
      console.error('Error updating whatsapp_channels row:', updateError)
      return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      channel: { ...updated, registered: updated.registered_at != null },
      phone_info: phoneInfo,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/whatsapp/channels/[id]
 *
 * Removes a channel. Conversations/broadcasts that referenced it keep
 * working — channel_id is ON DELETE SET NULL, and the resolver
 * (src/lib/whatsapp/channels.ts) falls back to the account's default
 * channel whenever channel_id is null.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, accountId } = await requireRole('admin')

    const { error } = await supabase
      .from('whatsapp_channels')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      console.error('Error deleting whatsapp_channels row:', error)
      return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
