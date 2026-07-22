import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { resolveChannelByPhoneNumberId, resolveAccountOwnerUserId } from '@/lib/whatsapp/channels'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { extensionForMimeType } from '@/lib/whatsapp/mime'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { ensureContactTagByName } from '@/lib/contacts/auto-tag'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { handleNpsResponse } from '@/lib/nps/webhook-handler'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import { dispatchWebhookOutEvent } from '@/lib/integrations/webhook-out'

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  /**
   * Set when the customer taps a Quick Reply button on a template
   * message we sent. This is a distinct shape from `interactive` above —
   * Meta uses `type: "button"` (not `type: "interactive"`) for taps on
   * template quick-reply buttons, vs. taps on interactive list/button
   * messages sent outside of templates.
   */
  button?: { payload: string; text: string }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch every channel's verify_token, plus the legacy whatsapp_config
    // rows for accounts that predate the whatsapp_channels backfill
    // (migration 036). Either table can hold the token that matches
    // whatever the caller configured in Meta's webhook setup screen.
    const [{ data: channels, error: channelsError }, { data: configs, error: configError }] =
      await Promise.all([
        supabaseAdmin().from('whatsapp_channels').select('id, verify_token'),
        supabaseAdmin().from('whatsapp_config').select('id, verify_token'),
      ])

    if (channelsError || configError) {
      console.error('Error fetching verify tokens:', channelsError || configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any channel's (or legacy config's) verify_token matches.
    // Also collect the matching row so we can opportunistically upgrade
    // its token to GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    let matchedTable: 'whatsapp_channels' | 'whatsapp_config' = 'whatsapp_channels'
    for (const config of [...(channels ?? []), ...(configs ?? [])]) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          matchedTable = (channels ?? []).includes(config) ? 'whatsapp_channels' : 'whatsapp_config'
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from(matchedTable)
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process asynchronously so we can ack Meta within their timeout.
  processWebhook(body).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler. Skip the messaging branches below so we
      // don't try to read message-shaped fields off a template event.
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin(),
        )
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Resolve which channel (or, pre-migration-036, legacy
      // whatsapp_config row) received this message. Logs + drops the
      // message the same way the old single-config lookup did when the
      // number isn't recognised at all or maps to more than one row.
      const resolved = await resolveChannelByPhoneNumberId(supabaseAdmin(), phoneNumberId)
      if (!resolved) {
        console.error('No channel found for phone_number_id:', phoneNumberId)
        continue
      }

      const configOwnerUserId = await resolveAccountOwnerUserId(supabaseAdmin(), resolved.accountId)
      if (!configOwnerUserId) {
        console.error('No account owner found for account_id:', resolved.accountId)
        continue
      }

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          resolved.accountId,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. The
          // account's owner, stable regardless of which channel
          // handled the message.
          configOwnerUserId,
          resolved.accessToken,
          resolved.phoneNumberId,
          // Which channel received this — stamped onto the
          // conversation so the inbox can show which number it came in
          // on. Null when resolved from the legacy whatsapp_config row.
          resolved.channelId,
        )
      }
    }
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status.
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id)

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
    return
  }
  if (!recipient) return // message wasn't part of a broadcast — fine

  // Guard transitions — forward-only on the success ladder, and
  // `failed` only from pre-delivered states.
  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status }
  if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso

  const { error: recUpdateErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .update(update)
    .eq('id', recipient.id)

  if (recUpdateErr) {
    console.error('Error updating broadcast recipient status:', recUpdateErr)
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * A contact's very first-ever inbound message gets a live card on the
 * pipeline — covers both a brand-new contact and one whose row already
 * existed (CSV-imported, added as broadcast audience) but never
 * messaged before. Callers MUST gate this on `isFirstInboundMessage`
 * (same gate as the Ativo/Receptivo origin tag above) — an existing
 * contact who already has a history and just sends another reply must
 * NOT get a deal auto-created; that over-eager behavior is exactly what
 * commit 13e8331 reverted.
 *
 * Title is the contact's name, falling back to their phone when no
 * name is on file — never a generic placeholder like "Novo Lead".
 *
 * Best-effort: failures here must not break the main inbound-message
 * flow, so errors are swallowed with a log.
 */
async function ensureOpenDealForContact(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  contactName: string,
  contactPhone: string,
) {
  try {
    const { data: existingOpenDeal, error: existingErr } = await supabaseAdmin()
      .from('deals')
      .select('id')
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (existingErr) {
      console.error('[webhook] open-deal lookup failed:', existingErr.message)
      return
    }
    if (existingOpenDeal) return // already has one — never duplicate

    const { data: defaultPipeline, error: pipelineErr } = await supabaseAdmin()
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pipelineErr || !defaultPipeline) return // no pipeline to file it under

    const { data: firstStage, error: stageErr } = await supabaseAdmin()
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', defaultPipeline.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (stageErr || !firstStage) return // pipeline has no stages yet

    const { error: insertErr } = await supabaseAdmin().from('deals').insert({
      user_id: configOwnerUserId,
      account_id: accountId,
      pipeline_id: defaultPipeline.id,
      stage_id: firstStage.id,
      contact_id: contactId,
      title: contactName || contactPhone,
      value: 0,
      status: 'open',
    })
    if (insertErr) {
      console.error('[webhook] failed to auto-create deal:', insertErr.message)
    }
  } catch (err) {
    console.error('ensureOpenDealForContact failed:', err)
  }
}

/**
 * When a customer taps a Quick Reply button on a template message,
 * correlate the tap back to the broadcast_recipients row that sent that
 * template so reports can show "X clicked button A, Y clicked button B".
 *
 * Correlation strategy:
 *  1. Exact match — a button tap's `context.id` is the Meta message id of
 *     the template message that carried the button. If it was sent via a
 *     broadcast, `broadcast_recipients.whatsapp_message_id` equals it.
 *  2. Fallback — same heuristic as flagBroadcastReplyIfAny: the contact's
 *     most recent still-open broadcast_recipients row. Covers the rare
 *     case where Meta omits `context` on the tap.
 *
 * Best-effort: failures are logged and swallowed so a tracking miss never
 * breaks the main inbound-message flow.
 */
async function trackBroadcastButtonClick(
  accountId: string,
  contactId: string,
  contextMessageId: string | undefined,
  buttonLabel: string
) {
  try {
    let recipientId: string | null = null

    if (contextMessageId) {
      const { data, error } = await supabaseAdmin()
        .from('broadcast_recipients')
        .select('id, broadcasts!inner(account_id)')
        .eq('whatsapp_message_id', contextMessageId)
        .eq('broadcasts.account_id', accountId)
        .maybeSingle()
      if (error) {
        console.error('[webhook] button-click lookup by context failed:', error.message)
      } else if (data) {
        recipientId = data.id
      }
    }

    if (!recipientId) {
      const { data: recs, error } = await supabaseAdmin()
        .from('broadcast_recipients')
        .select('id, broadcasts!inner(account_id)')
        .eq('contact_id', contactId)
        .eq('broadcasts.account_id', accountId)
        .in('status', ['sent', 'delivered', 'read', 'replied'])
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) {
        console.error('[webhook] button-click fallback lookup failed:', error.message)
      } else if (recs && recs.length > 0) {
        recipientId = recs[0].id
      }
    }

    if (!recipientId) return

    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({
        button_clicked: buttonLabel,
        button_clicked_at: new Date().toISOString(),
      })
      .eq('id', recipientId)
    if (updErr) {
      console.error('[webhook] failed to record button click:', updErr.message)
    }
  } catch (err) {
    console.error('trackBroadcastButtonClick failed:', err)
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  // Tenancy. Resolved from the matched whatsapp_channels (or legacy
  // whatsapp_config) row; every contact / conversation / message row
  // created downstream is stamped with this so any member of the
  // account can see it.
  accountId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK
  // (contacts, conversations). Always the account owner — stable
  // regardless of which channel/admin set up the number.
  configOwnerUserId: string,
  accessToken: string,
  phoneNumberId: string,
  // Which whatsapp_channels row received this message. Null when
  // resolved from the legacy whatsapp_config row (pre-migration-036
  // accounts) — findOrCreateConversation leaves channel_id untouched
  // in that case rather than clearing it to null.
  channelId: string | null,
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id,
    channelId,
  )
  if (!conversation) return

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update last_message_text.
  // Done before parseMessageContent so the media-URL fetch is skipped.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaMimeType, mediaFilename, interactiveReplyId } =
    await parseMessageContent(message, accessToken, accountId)

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql, plus
  // add_message_media_columns for media_mime_type/media_filename):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, media_mime_type, media_filename, template_name,
  //   message_id, status, created_at

  // The messages.content_type CHECK constraint (widened in migration 010
  // to add 'interactive' for button/list taps) allows:
  //   text, image, document, audio, video, location, template, interactive
  // Map incoming WhatsApp types that aren't in that list to the closest
  // allowed value so the INSERT doesn't fail with a constraint error.
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'   // stickers are images
      : 'text'    // reaction, unknown → text fallback

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    media_mime_type: mediaMimeType,
    media_filename: mediaFilename,
    message_id: message.id,
    status: 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    reply_to_message_id: replyToInternalId,
    // Only populated for content_type='interactive'. Migration 010 added
    // the column; null for every other content_type so existing inserts
    // behave identically.
    interactive_reply_id: interactiveReplyId,
  })

  if (msgError) {
    console.error('Error inserting message:', msgError)
    return
  }

  // Outbound webhook — repasses este evento para a URL externa (n8n,
  // Zapier, Make...) configurada em Configurações → Integrações →
  // Webhook de Saída, no formato compatível com a Evolution API. No-op
  // if the account never configured one (see dispatchWebhookOutEvent).
  // Fire-and-forget: must never block Meta's ack or fail the webhook
  // over a slow/broken external endpoint.
  void dispatchWebhookOutEvent(accountId, 'MESSAGES_UPSERT', async (webhookUrl) => {
    const channelName = channelId
      ? (
          await supabaseAdmin()
            .from('whatsapp_channels')
            .select('name')
            .eq('id', channelId)
            .maybeSingle()
        ).data?.name
      : null
    return {
      event: 'MESSAGES_UPSERT',
      instance: channelName ?? phoneNumberId,
      data: {
        key: {
          remoteJid: `${contactRecord.phone}@s.whatsapp.net`,
          fromMe: false,
          id: message.id,
        },
        message: {
          conversation: contentText,
        },
        messageType: contentType,
        messageTimestamp: Date.now(),
        pushName: contactRecord.name,
      },
      destination: webhookUrl,
      date_time: new Date().toISOString(),
      sender: contactRecord.phone,
      server_url: process.env.NEXT_PUBLIC_SITE_URL,
    }
  }).catch((err) => console.error('[webhook-out] MESSAGES_UPSERT dispatch failed:', err))

  // Update conversation. A closed conversation reopens on a fresh
  // customer reply — the agent marked it done under the old context,
  // and a new inbound message means the customer is back with something
  // that needs attention again.
  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
      ...(conversation.status === 'closed' ? { status: 'open' } : {}),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  // Origin tagging — classified once, on the contact's first-ever
  // inbound message. Deliberately gated on `isFirstInboundMessage`
  // (not `contactOutcome.wasCreated`): it needs to also cover a
  // contact whose row already existed — e.g. CSV-imported or added as
  // a broadcast audience member — replying for the very first time.
  // A contact who already messaged before keeps whatever origin tag
  // they got the first time; re-checking on every reply would
  // misclassify someone who reached out organically and was later
  // also targeted by a broadcast, or vice versa.
  //
  //   - Already in broadcast_recipients → "Ativo" (responding to a
  //     broadcast we sent them).
  //   - Otherwise → "Receptivo" (reached out on their own).
  if (isFirstInboundMessage) {
    const { data: broadcastRecipient } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id')
      .eq('contact_id', contactRecord.id)
      .limit(1)
      .maybeSingle()
    const originTag = broadcastRecipient ? 'Ativo' : 'Receptivo'
    await ensureContactTagByName(supabaseAdmin(), accountId, contactRecord.id, [originTag])

    // Same first-message gate as the origin tag above — a contact's
    // first-ever reply (organic or answering a broadcast) gets a
    // pipeline card; an existing contact just sending another message
    // never does. See ensureOpenDealForContact's docstring.
    await ensureOpenDealForContact(
      accountId,
      configOwnerUserId,
      contactRecord.id,
      contactRecord.name,
      contactRecord.phone,
    )
  }

  // NPS survey response check — must run before flow/automation
  // dispatch below. A message answering a pending survey (rating or
  // follow-up comment) is consumed here and must NOT also trigger
  // keyword-match automations or advance an unrelated flow.
  if (message.type === 'text') {
    const npsConsumed = await handleNpsResponse({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      contactPhone: contactRecord.phone,
      phoneNumberId,
      accessToken,
      text: contentText ?? message.text?.body ?? '',
    })
    if (npsConsumed) return
  }

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (via the aggregate
  // trigger installed in migration 003).
  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  // Quick Reply tap on a broadcast template — record which button for
  // per-broadcast click reporting (migration 029).
  if (message.type === 'button' && message.button?.text) {
    await trackBroadcastButtonClick(
      accountId,
      contactRecord.id,
      message.context?.id,
      message.button.text
    )
    // button_clicked automations — fire-and-forget, same as the other
    // trigger dispatches below.
    runAutomationsForTrigger({
      accountId,
      triggerType: 'button_clicked',
      contactId: contactRecord.id,
      context: {
        conversation_id: conversation.id,
        vars: { button_text: message.button.text },
      },
    }).catch((err) => console.error('[automations] button_clicked dispatch failed:', err))
  }

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }
}

/**
 * Download an inbound media item from Meta and persist it to the
 * `media` Storage bucket so the inbox never depends on Meta's
 * short-lived signed URL — or on the media_id remaining resolvable —
 * again. Returns null on any failure (network, decode, upload); the
 * caller degrades to "media unavailable" rather than dropping the
 * whole inbound message.
 */
async function downloadAndStoreMedia(
  mediaId: string,
  accessToken: string,
  accountId: string,
): Promise<{ url: string; mimeType: string } | null> {
  try {
    const { url: tempUrl, mimeType } = await getMediaUrl({ mediaId, accessToken })
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: tempUrl,
      accessToken,
    })
    const resolvedMime = contentType || mimeType
    const path = `${accountId}/${mediaId}.${extensionForMimeType(resolvedMime)}`

    const { error: uploadError } = await supabaseAdmin()
      .storage
      .from('media')
      .upload(path, buffer, { contentType: resolvedMime, upsert: true })
    if (uploadError) {
      console.error(`Failed to upload media ${mediaId} to Storage:`, uploadError)
      return null
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin().storage.from('media').getPublicUrl(path)
    return { url: publicUrl, mimeType: resolvedMime }
  } catch (error) {
    console.error(
      `Failed to download/store media ${mediaId}:`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string,
  accountId: string,
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaMimeType: string | null
  mediaFilename: string | null
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null
}> {
  // Default shape — each case overrides only the fields it cares about.
  // Keeps new fields DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaMimeType: null,
    mediaFilename: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        const stored = await downloadAndStoreMedia(message.image.id, accessToken, accountId)
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: stored?.url ?? null,
          mediaMimeType: stored?.mimeType ?? message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        const stored = await downloadAndStoreMedia(message.video.id, accessToken, accountId)
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: stored?.url ?? null,
          mediaMimeType: stored?.mimeType ?? message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        const stored = await downloadAndStoreMedia(message.document.id, accessToken, accountId)
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: stored?.url ?? null,
          mediaMimeType: stored?.mimeType ?? message.document.mime_type,
          mediaFilename: message.document.filename || null,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        const stored = await downloadAndStoreMedia(message.audio.id, accessToken, accountId)
        return {
          ...empty,
          mediaUrl: stored?.url ?? null,
          mediaMimeType: stored?.mimeType ?? message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        const stored = await downloadAndStoreMedia(message.sticker.id, accessToken, accountId)
        return {
          ...empty,
          mediaUrl: stored?.url ?? null,
          mediaMimeType: stored?.mimeType ?? message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    case 'button':
      // Quick Reply button tap on a template message. Render like a
      // normal text message using the button's visible label.
      return { ...empty, contentText: message.button?.text || null }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  // Find an existing contact for this account by phone. The shared
  // helper pre-filters in SQL by the last-8-digit suffix (so we don't
  // pull every contact on every inbound message) then applies the
  // strict `phonesMatch` in JS on the small candidate set. The same
  // helper backs the manual contact form and CSV import, so all three
  // paths agree on what "same number" means (issue #212).
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone,
  )

  if (existingContact) {
    // Deliberately does NOT sync `name` from the WhatsApp profile name
    // here. This used to overwrite the contact's name on every inbound
    // message where the two differed — which meant any agent
    // correction (or CSV-imported real name) got silently clobbered by
    // the customer's own WhatsApp display name the next time they
    // texted (bug #4). The contact record is the source of truth once
    // it exists; only the initial insert below seeds name from the
    // WhatsApp profile.
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact. account_id is the tenancy column;
  // user_id is the NOT NULL FK audit column (no inbound message
  // has a single "user who created" it — we attribute to the
  // WhatsApp config owner as a stable default).
  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery (or another path)
    // created this contact between our lookup and insert, and the
    // unique index (migration 022) rejected the duplicate. Re-resolve
    // the existing row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  // Which whatsapp_channels row received the message that triggered
  // this lookup. Null (legacy whatsapp_config fallback) leaves an
  // existing conversation's channel_id untouched rather than clearing
  // it — only a resolved channel ever overwrites it.
  channelId: string | null,
) {
  // Look for existing conversation in this account
  const { data: existing, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    // Keep channel_id current — a contact may start messaging a
    // different number than the one that first created this
    // conversation, and the inbox badge should reflect the latest one.
    if (channelId && existing.channel_id !== channelId) {
      const { data: updated, error: updateError } = await supabaseAdmin()
        .from('conversations')
        .update({ channel_id: channelId })
        .eq('id', existing.id)
        .select()
        .single()
      if (updateError) {
        console.error('Error updating conversation channel_id:', updateError)
        return existing
      }
      return updated
    }
    return existing
  }

  // Create new conversation. Same tenancy + audit split as
  // findOrCreateContact above.
  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      channel_id: channelId,
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating conversation:', createError)
    return null
  }

  return newConv
}
