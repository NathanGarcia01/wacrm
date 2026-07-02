import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MetaApiError, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { isWithinBusinessHours, nextBusinessHoursStart } from '@/lib/broadcast-cadence'
import {
  resolveVariables,
  fetchCustomValueIndex,
  type VariableMapping,
} from '@/lib/broadcast-variables'

// Lazy service-role client — mirrors the inline pattern used by
// src/app/api/whatsapp/webhook/route.ts and src/lib/automations/admin-client.ts.
let _adminClient: SupabaseClient | null = null
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomDelayMs(minSeconds: number, maxSeconds: number): number {
  const min = Math.min(minSeconds, maxSeconds)
  const max = Math.max(minSeconds, maxSeconds)
  return Math.round((min + Math.random() * (max - min)) * 1000)
}

/**
 * How many due broadcasts to look at per tick, and how much wall-clock
 * time this single HTTP request is allowed to spend sending messages.
 *
 * Cadence settings (batch size up to 200, per-message delay up to
 * ~2 min) intentionally describe pacing across MANY worker ticks, not
 * one request's duration — a naive "process one whole batch per
 * invocation" design could hold a request open for tens of minutes,
 * which no reverse proxy / cron pinger tolerates. Instead each tick
 * chips away at the current batch for up to REQUEST_TIME_BUDGET_MS
 * and leaves the rest `pending` for the next tick (immediately
 * eligible — see `next_batch_at = now()` below when a batch isn't
 * full yet). The pause BETWEEN batches is still enforced via
 * `next_batch_at`, so anti-ban pacing is unaffected by this chunking.
 */
const MAX_BROADCASTS_PER_TICK = 5
const REQUEST_TIME_BUDGET_MS = 45_000
const RECIPIENT_FETCH_LIMIT = 50
const RATE_LIMIT_ERROR_CODE = 130429
const RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000

interface BroadcastRow {
  id: string
  account_id: string
  template_name: string
  template_language: string
  template_variables: Record<string, VariableMapping> | null
  batch_size: number
  batch_interval_minutes: number
  message_delay_min_seconds: number
  message_delay_max_seconds: number
  respect_business_hours: boolean
  current_batch: number
  current_batch_sent: number
}

type RecipientContact = {
  id: string
  phone: string | null
  name: string | null
  email: string | null
  company: string | null
}

interface RecipientRow {
  id: string
  contact_id: string | null
  contact: RecipientContact | RecipientContact[] | null
}

function oneContact(contact: RecipientRow['contact']): RecipientContact | null {
  if (!contact) return null
  return Array.isArray(contact) ? (contact[0] ?? null) : contact
}

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const startedAt = Date.now()
  const nowIso = () => new Date().toISOString()

  const { data: due, error } = await admin
    .from('broadcasts')
    .select(
      'id, account_id, template_name, template_language, template_variables, batch_size, batch_interval_minutes, message_delay_min_seconds, message_delay_max_seconds, respect_business_hours, current_batch, current_batch_sent',
    )
    .in('status', ['scheduled', 'sending'])
    .or(`next_batch_at.is.null,next_batch_at.lte.${nowIso()}`)
    .order('next_batch_at', { ascending: true, nullsFirst: true })
    .limit(MAX_BROADCASTS_PER_TICK)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let broadcastsAdvanced = 0
  let messagesSent = 0
  let messagesFailed = 0

  for (const row of due as BroadcastRow[]) {
    if (Date.now() - startedAt > REQUEST_TIME_BUDGET_MS) break

    // Claim: push next_batch_at far into the future so an overlapping
    // tick (slow previous request, retried pinger) can't grab the same
    // broadcast. If nothing matched, someone else already claimed it.
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const { data: claimed } = await admin
      .from('broadcasts')
      .update({ status: 'sending', next_batch_at: lockUntil })
      .eq('id', row.id)
      .in('status', ['scheduled', 'sending'])
      .or(`next_batch_at.is.null,next_batch_at.lte.${nowIso()}`)
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    // Business hours gate — don't touch any recipients this tick, just
    // reschedule for the next allowed window.
    if (row.respect_business_hours && !isWithinBusinessHours(new Date())) {
      await admin
        .from('broadcasts')
        .update({ next_batch_at: nextBusinessHoursStart(new Date()).toISOString() })
        .eq('id', row.id)
      continue
    }

    const { data: config } = await admin
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', row.account_id)
      .single()

    if (!config) {
      // Nothing we can do without WhatsApp config — pause for an hour
      // rather than busy-looping on a broadcast that can never send.
      await admin
        .from('broadcasts')
        .update({ next_batch_at: new Date(Date.now() + RATE_LIMIT_PAUSE_MS).toISOString() })
        .eq('id', row.id)
      continue
    }

    const accessToken = decrypt(config.access_token)

    const { data: rawTemplateRow } = await admin
      .from('message_templates')
      .select('*')
      .eq('account_id', row.account_id)
      .eq('name', row.template_name)
      .eq('language', row.template_language || 'en_US')
      .maybeSingle()
    const templateRow = rawTemplateRow && isMessageTemplate(rawTemplateRow) ? rawTemplateRow : null

    const { data: recipients } = await admin
      .from('broadcast_recipients')
      .select('id, contact_id, contact:contacts(id, phone, name, email, company)')
      .eq('broadcast_id', row.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(RECIPIENT_FETCH_LIMIT)

    const customValueIndex = await fetchCustomValueIndex(
      admin,
      ((recipients ?? []) as RecipientRow[])
        .map((r) => oneContact(r.contact)?.id)
        .filter((id): id is string => Boolean(id)),
    )

    let batchSentDelta = 0
    let rateLimited = false

    for (const recipient of (recipients ?? []) as RecipientRow[]) {
      if (Date.now() - startedAt > REQUEST_TIME_BUDGET_MS) break

      const contact = oneContact(recipient.contact)
      const rawPhone = contact?.phone
      if (!rawPhone) {
        await admin
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: 'No phone number on contact' })
          .eq('id', recipient.id)
        batchSentDelta++
        continue
      }

      const sanitized = sanitizePhoneForMeta(rawPhone)
      if (!isValidE164(sanitized)) {
        await admin
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: 'Invalid phone number format' })
          .eq('id', recipient.id)
        batchSentDelta++
        continue
      }

      await sleep(randomDelayMs(row.message_delay_min_seconds, row.message_delay_max_seconds))

      const params = row.template_variables
        ? resolveVariables(row.template_variables, contact, customValueIndex.get(contact.id))
        : []

      let sentMessageId: string | null = null
      let lastError: unknown = null
      for (const variant of phoneVariants(sanitized)) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: row.template_name,
            language: row.template_language || 'en_US',
            template: templateRow ?? undefined,
            params,
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (err) {
          lastError = err
          const message = err instanceof Error ? err.message : 'Unknown error'
          if (!isRecipientNotAllowedError(message)) break
          // else: retry with the next phone variant
        }
      }

      if (sentMessageId) {
        await admin
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id: sentMessageId,
            error_message: null,
          })
          .eq('id', recipient.id)
        messagesSent++
        batchSentDelta++
        continue
      }

      if (lastError instanceof MetaApiError && lastError.code === RATE_LIMIT_ERROR_CODE) {
        // Meta is rate-limiting this number. Leave this recipient (and
        // everything after it) `pending` and back off the whole
        // broadcast for an hour before trying again.
        rateLimited = true
        break
      }

      const message = lastError instanceof Error ? lastError.message : 'Unknown error'
      await admin
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: message })
        .eq('id', recipient.id)
      messagesFailed++
      batchSentDelta++
    }

    if (rateLimited) {
      await admin
        .from('broadcasts')
        .update({ next_batch_at: new Date(Date.now() + RATE_LIMIT_PAUSE_MS).toISOString() })
        .eq('id', row.id)
      broadcastsAdvanced++
      continue
    }

    const { count: remainingPending } = await admin
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', row.id)
      .eq('status', 'pending')

    if (!remainingPending) {
      await admin
        .from('broadcasts')
        .update({ status: 'sent', next_batch_at: null })
        .eq('id', row.id)
    } else {
      const newBatchSent = row.current_batch_sent + batchSentDelta
      if (newBatchSent >= row.batch_size) {
        let pauseUntil = new Date(Date.now() + row.batch_interval_minutes * 60 * 1000)
        if (row.respect_business_hours && !isWithinBusinessHours(pauseUntil)) {
          pauseUntil = nextBusinessHoursStart(pauseUntil)
        }
        await admin
          .from('broadcasts')
          .update({
            current_batch: row.current_batch + 1,
            current_batch_sent: 0,
            next_batch_at: pauseUntil.toISOString(),
          })
          .eq('id', row.id)
      } else {
        await admin
          .from('broadcasts')
          .update({
            current_batch_sent: newBatchSent,
            next_batch_at: nowIso(),
          })
          .eq('id', row.id)
      }
    }
    broadcastsAdvanced++
  }

  return NextResponse.json({ broadcastsAdvanced, messagesSent, messagesFailed })
}
