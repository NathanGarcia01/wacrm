import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  createEvolutionInstance,
  deleteEvolutionInstance,
  generateEvolutionInstanceName,
  getEvolutionQrCode,
  setEvolutionWebhook,
} from '@/lib/whatsapp/evolution-client'

function evolutionWebhookUrl(): string {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed, same philosophy as verifyMetaWebhookSignature — an
    // Evolution webhook with no secret configured is a fully spoofable
    // endpoint (Evolution doesn't sign its webhook payloads the way
    // Meta does), so refuse to wire one up rather than silently
    // running unauthenticated.
    throw new Error(
      'EVOLUTION_WEBHOOK_SECRET is not configured — refusing to create an Evolution channel until it is set.',
    )
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.funilly.tech'
  return `${base}/api/whatsapp/evolution-webhook?secret=${encodeURIComponent(secret)}`
}

/**
 * POST /api/whatsapp/channels/evolution
 *
 * Creates a QR-code-based WhatsApp channel: spins up an Evolution API
 * instance, points its webhook back at us, stores a whatsapp_channels
 * row (channel_type='evolution'), and returns the pairing QR code for
 * the client to render immediately — no separate "now fetch the QR"
 * round trip needed for the happy path.
 *
 * Deliberately a separate route from POST /api/whatsapp/channels
 * (Cloud API): the two flows share almost nothing — one verifies
 * Meta credentials the caller already has, this one orchestrates
 * three external calls and only needs a display name.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    let webhookUrl: string
    try {
      webhookUrl = evolutionWebhookUrl()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Evolution webhook misconfigured'
      console.error('[whatsapp/channels/evolution] webhook URL error:', message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const instanceName = generateEvolutionInstanceName(accountId)

    try {
      await createEvolutionInstance(instanceName)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
      console.error('[whatsapp/channels/evolution] createInstance failed:', message)
      return NextResponse.json({ error: `Evolution API error: ${message}` }, { status: 502 })
    }

    // The very first channel on an account is always the default —
    // same rule as the Cloud API create route.
    const { count: existingChannelCount } = await supabase
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    const isDefault = existingChannelCount === 0

    if (isDefault) {
      const { error: unsetError } = await supabase
        .from('whatsapp_channels')
        .update({ is_default: false })
        .eq('account_id', accountId)
      if (unsetError) {
        console.error('Error clearing previous default channel:', unsetError)
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_channels')
      .insert({
        account_id: accountId,
        name,
        channel_type: 'evolution',
        // Placeholders to satisfy NOT NULL / UNIQUE(account_id,
        // phone_number_id) — never read back for evolution rows. See
        // migration 052's header comment.
        phone_number_id: instanceName,
        access_token_encrypted: encrypt(instanceName),
        evolution_instance_name: instanceName,
        evolution_status: 'connecting',
        is_active: true,
        is_default: isDefault,
        created_by: userId,
      })
      .select('id, name, evolution_instance_name, evolution_status, is_active, is_default, created_at')
      .single()

    if (insertError) {
      console.error('[whatsapp/channels/evolution] insert failed:', insertError)
      // The DB row is what everything else (webhook lookup, status
      // polling, deletion) keys off — without it the instance we just
      // created on the Evolution side would be permanently orphaned,
      // so clean it up rather than leaving a dangling session.
      await deleteEvolutionInstance(instanceName).catch((err) =>
        console.error('[whatsapp/channels/evolution] cleanup delete failed:', err),
      )
      return NextResponse.json({ error: 'Failed to save channel' }, { status: 500 })
    }

    // Best-effort — the channel already exists and is pollable/
    // reconnectable even if this particular call fails (e.g. a
    // transient Evolution hiccup); don't fail channel creation over it.
    try {
      await setEvolutionWebhook(instanceName, webhookUrl)
    } catch (err) {
      console.error(
        '[whatsapp/channels/evolution] setWebhook failed (channel created anyway):',
        err instanceof Error ? err.message : err,
      )
    }

    let qrCode: string | null = null
    let qrError: string | null = null
    try {
      const qr = await getEvolutionQrCode(instanceName)
      qrCode = qr.base64
    } catch (err) {
      qrError = err instanceof Error ? err.message : 'Unknown Evolution API error'
      console.error('[whatsapp/channels/evolution] getQrCode failed:', qrError)
    }

    return NextResponse.json({
      success: true,
      channel: { ...inserted, registered: false },
      qr_code_base64: qrCode,
      qr_error: qrError,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
