import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { resolveChannelByEvolutionInstance, resolveAccountOwnerUserId } from '@/lib/whatsapp/channels'
import {
  ensureOpenDealForContact,
  findOrCreateContact,
  findOrCreateConversation,
} from '@/lib/whatsapp/inbound-message'
import { ensureContactTagByName } from '@/lib/contacts/auto-tag'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { runFlowsForTrigger } from '@/lib/flows/workflow-engine'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * Evolution doesn't sign its webhook payloads the way Meta does (no
 * HMAC header to verify) — the URL we register at channel-creation
 * time (see /api/whatsapp/channels/evolution) embeds this secret as a
 * query param instead, and every request must present it. Fails
 * closed, same as verifyMetaWebhookSignature: a misconfigured/missing
 * secret rejects every request rather than falling open.
 */
function verifyEvolutionWebhookSecret(request: Request): boolean {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!expected) {
    console.error('[evolution-webhook] EVOLUTION_WEBHOOK_SECRET is not set — rejecting request.')
    return false
  }
  const provided = new URL(request.url).searchParams.get('secret')
  return provided === expected
}

interface EvolutionBaileysMessage {
  key: { remoteJid: string; fromMe: boolean; id: string }
  pushName?: string
  messageTimestamp?: number | string
  message?: {
    conversation?: string
    extendedTextMessage?: { text?: string }
    imageMessage?: { caption?: string }
    videoMessage?: { caption?: string }
    documentMessage?: { caption?: string; fileName?: string }
    audioMessage?: Record<string, never>
    stickerMessage?: Record<string, never>
  }
}

interface EvolutionWebhookBody {
  event?: string
  instance?: string
  data?: unknown
}

export async function POST(request: Request) {
  if (!verifyEvolutionWebhookSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: EvolutionWebhookBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process asynchronously so we ack fast, same pattern as the Meta
  // webhook — Evolution retries on a slow/failed response.
  processEvolutionWebhook(body).catch((error) => {
    console.error('[evolution-webhook] processing failed:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processEvolutionWebhook(body: EvolutionWebhookBody) {
  const { event, instance, data } = body
  if (!event || !instance) return

  const resolved = await resolveChannelByEvolutionInstance(supabaseAdmin(), instance)
  if (!resolved) {
    console.error('[evolution-webhook] no channel found for instance:', instance)
    return
  }

  if (event === 'CONNECTION_UPDATE') {
    await handleConnectionUpdate(resolved.channelId, data)
    return
  }

  if (event === 'MESSAGES_UPSERT') {
    await handleMessagesUpsert(resolved.channelId, resolved.accountId, data)
    return
  }

  // MESSAGES_UPDATE (delivery/read receipts, edits) is subscribed to
  // (see setEvolutionWebhook) but not processed yet — Baileys' update
  // payload shape varies enough across message types that mapping it
  // onto messages.status without a live instance to verify against
  // risks silently mis-tagging message state. Acknowledged and
  // dropped rather than guessed at.
}

async function handleConnectionUpdate(channelId: string, data: unknown) {
  const state = (data as { state?: string } | undefined)?.state
  const normalized = state === 'open' || state === 'connecting' ? state : 'close'
  const { error } = await supabaseAdmin()
    .from('whatsapp_channels')
    .update({ evolution_status: normalized, updated_at: new Date().toISOString() })
    .eq('id', channelId)
  if (error) {
    console.error('[evolution-webhook] failed to update evolution_status:', error)
  }
}

function extractMessageText(msg: EvolutionBaileysMessage['message']): string | null {
  if (!msg) return null
  if (msg.conversation) return msg.conversation
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text
  if (msg.imageMessage) return msg.imageMessage.caption || '[Imagem recebida]'
  if (msg.videoMessage) return msg.videoMessage.caption || '[Vídeo recebido]'
  if (msg.documentMessage) {
    return msg.documentMessage.caption || msg.documentMessage.fileName || '[Documento recebido]'
  }
  if (msg.audioMessage) return '[Áudio recebido]'
  if (msg.stickerMessage) return '[Figurinha recebida]'
  return null
}

async function handleMessagesUpsert(channelId: string, accountId: string, data: unknown) {
  // Evolution sends either a single message object or (less commonly,
  // depending on version) an array under `data.messages` — normalize
  // to a list so both shapes work.
  const raw = data as { messages?: EvolutionBaileysMessage[] } & Partial<EvolutionBaileysMessage>
  const messages: EvolutionBaileysMessage[] = Array.isArray(raw.messages)
    ? raw.messages
    : raw.key
      ? [raw as EvolutionBaileysMessage]
      : []

  const admin = supabaseAdmin()
  const configOwnerUserId = await resolveAccountOwnerUserId(admin, accountId)
  if (!configOwnerUserId) {
    console.error('[evolution-webhook] no account owner found for account_id:', accountId)
    return
  }

  for (const message of messages) {
    await processEvolutionMessage(admin, accountId, configOwnerUserId, channelId, message)
  }
}

async function processEvolutionMessage(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  configOwnerUserId: string,
  channelId: string,
  message: EvolutionBaileysMessage,
) {
  // Our own outbound sends (via /api/whatsapp/send, which calls
  // sendEvolutionText directly) get mirrored back through this same
  // webhook by Baileys — fromMe distinguishes "we sent this" from a
  // genuine inbound reply. Without this filter, every agent message
  // would insert a second, duplicate row.
  if (message.key?.fromMe) return

  const remoteJid = message.key?.remoteJid
  if (!remoteJid) return

  // Group chats (`@g.us`) don't map onto this CRM's 1:1 phone-based
  // contact model — skip rather than trying to force a group JID
  // through findOrCreateContact as if it were a phone number.
  if (remoteJid.endsWith('@g.us')) return

  const phone = normalizePhone(remoteJid.split('@')[0])
  if (!phone) return

  const contentText = extractMessageText(message.message)
  if (contentText === null) return // unrecognized message shape — nothing to store

  const contactName = message.pushName || phone

  const contactOutcome = await findOrCreateContact(admin, accountId, configOwnerUserId, phone, contactName)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const conversation = await findOrCreateConversation(
    admin,
    accountId,
    configOwnerUserId,
    contactRecord.id,
    channelId,
  )
  if (!conversation) return

  const { count: priorCustomerMsgCount } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const tsRaw = message.messageTimestamp
  const tsSeconds = typeof tsRaw === 'string' ? parseInt(tsRaw, 10) : tsRaw
  const createdAt =
    typeof tsSeconds === 'number' && Number.isFinite(tsSeconds) && tsSeconds > 0
      ? new Date(tsSeconds * 1000).toISOString()
      : new Date().toISOString()

  const { error: msgError } = await admin.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: 'text',
    content_text: contentText,
    message_id: message.key.id,
    status: 'delivered',
    created_at: createdAt,
  })
  if (msgError) {
    console.error('[evolution-webhook] failed to insert message:', msgError)
    return
  }

  const { error: convError } = await admin
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
      ...(conversation.status === 'closed' ? { status: 'open' } : {}),
    })
    .eq('id', conversation.id)
  if (convError) {
    console.error('[evolution-webhook] failed to update conversation:', convError)
  }

  // Same origin-tagging + auto-deal behavior as the Meta webhook — a
  // lead's first message should behave identically in the CRM
  // regardless of which channel type answered it.
  if (isFirstInboundMessage) {
    await ensureContactTagByName(admin, accountId, contactRecord.id, ['Receptivo'])
    await ensureOpenDealForContact(
      admin,
      accountId,
      configOwnerUserId,
      contactRecord.id,
      contactRecord.name,
      contactRecord.phone,
    )
  }

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: contentText, meta_message_id: message.key.id },
    isFirstInboundMessage,
  })

  const triggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowResult.consumed) triggers.push('new_message_received', 'keyword_match')
  if (contactOutcome.wasCreated) triggers.unshift('new_contact_created')
  if (isFirstInboundMessage) triggers.unshift('first_inbound_message')

  for (const triggerType of triggers) {
    const input = {
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: contentText,
        conversation_id: conversation.id,
      },
    }
    runAutomationsForTrigger(input).catch((err) =>
      console.error('[evolution-webhook] automations dispatch failed:', err),
    )
    runFlowsForTrigger(input).catch((err) =>
      console.error('[evolution-webhook] workflow-engine dispatch failed:', err),
    )
  }
}
