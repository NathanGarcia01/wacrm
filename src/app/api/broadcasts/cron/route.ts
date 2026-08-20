import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MetaApiError, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { resolveChannelById, resolveAccountOwnerUserId } from '@/lib/whatsapp/channels'
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
import { ensureContactTagByName } from '@/lib/contacts/auto-tag'
import { computeAndSaveBroadcastCost } from '@/lib/broadcasts/meta-cost'

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
/**
 * Cap on CONSECUTIVE rate-limited ticks for one broadcast. Recipients
 * are retried oldest-first, so a single persistently-throttled (or
 * blocked) recipient otherwise re-triggers the same 130429 error on
 * every retry forever — pausing the whole broadcast an hour each time
 * with no way to ever reach remainingPending = 0. After this many
 * straight hits, the blocking recipient is force-failed so the rest
 * of the broadcast can proceed instead of stalling for days.
 */
const RATE_LIMIT_MAX_CONSECUTIVE_HITS = 3
/**
 * A recipient whose `last_attempted_at` (set right before we actually
 * call the Meta API — see below) is older than this and is still
 * `pending` never got a terminal status written after the attempt
 * (e.g. a Supabase write failing right after a successful Meta send).
 * Force-failed so the broadcast can still reach remainingPending = 0.
 * Deliberately NOT based on `created_at`: large/paced broadcasts
 * routinely leave recipients pending for hours by design (batch
 * pacing, business hours), and those haven't been attempted yet.
 */
const STALE_PENDING_MS = 60 * 60 * 1000

interface BroadcastRow {
  id: string
  account_id: string
  channel_id: string | null
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
  /** Anti-duplicate guard — skip a recipient at send time if they
   *  already have a `sent` broadcast_recipients row within this many
   *  days. 0/null disables the guard. Migration 040. */
  exclude_recent_days: number | null
  /** Tag ids applied to a contact right after each successful send.
   *  Migration 040. */
  tags_to_add: string[] | null
  /** Consecutive rate-limited ticks — see RATE_LIMIT_MAX_CONSECUTIVE_HITS.
   *  Migration 060. */
  rate_limit_hits: number | null
  /** pipeline_stage audience filter — the funnel stage recipients were
   *  drawn from. Paired with deal_status_filter so the cron can
   *  re-check per recipient at send time. Migration 064. */
  stage_id: string | null
  /** pipeline_stage audience filter — restricts recipients to deals
   *  with this status in `stage_id`. Null = no status filter.
   *  Migration 064. */
  deal_status_filter: 'open' | 'won' | 'lost' | null
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

/** Substitutes {{1}}, {{2}}, … in a template body with resolved params,
 *  so the inbox shows the actual rendered text rather than a placeholder. */
function renderTemplateText(bodyText: string, params: string[]): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_match, num: string) => params[Number(num) - 1] ?? '')
}

/**
 * Find or create the conversation for a broadcast recipient's contact,
 * mirroring findOrCreateConversation in the webhook handler — so a
 * broadcast send lands in the same conversation an inbound reply would.
 */
async function findOrCreateConversationForContact(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  channelId: string | null,
): Promise<string | null> {
  const { data: existing, error: findError } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (!findError && existing) return existing.id

  // Broadcast-originated conversations start closed — a one-way
  // template send shouldn't surface in the inbox as if it needs
  // attention. The webhook already reopens (status: 'open') the first
  // time this contact replies, so the conversation only appears once
  // there's actually something for an agent to read.
  const { data: created, error: createError } = await admin
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      status: 'closed',
      channel_id: channelId,
    })
    .select('id')
    .single()

  if (createError || !created) {
    console.error('[broadcasts/cron] failed to find/create conversation:', createError)
    return null
  }
  return created.id
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
      'id, account_id, channel_id, template_name, template_language, template_variables, batch_size, batch_interval_minutes, message_delay_min_seconds, message_delay_max_seconds, respect_business_hours, current_batch, current_batch_sent, exclude_recent_days, tags_to_add, rate_limit_hits, stage_id, deal_status_filter',
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
  let messagesSkipped = 0

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

    const config = await resolveChannelById(admin, row.channel_id, row.account_id)

    if (!config) {
      // Nothing we can do without WhatsApp config — pause for an hour
      // rather than busy-looping on a broadcast that can never send.
      await admin
        .from('broadcasts')
        .update({ next_batch_at: new Date(Date.now() + RATE_LIMIT_PAUSE_MS).toISOString() })
        .eq('id', row.id)
      continue
    }

    const accessToken = config.accessToken
    const configOwnerUserId = await resolveAccountOwnerUserId(admin, row.account_id)

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
    let rateLimitedRecipientId: string | null = null

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

      // Anti-duplicate guard, re-checked HERE (send time) rather than
      // only when the broadcast was created — a broadcast can trickle
      // out over many batches/days, so a contact who passed the
      // creation-time check can still pick up a `sent` row from an
      // overlapping broadcast in the meantime. Checking again right
      // before dispatch is what actually prevents the double-send.
      if (row.exclude_recent_days && row.exclude_recent_days > 0) {
        const cutoffIso = new Date(
          Date.now() - row.exclude_recent_days * 24 * 60 * 60 * 1000,
        ).toISOString()
        const { data: recentSend } = await admin
          .from('broadcast_recipients')
          .select('id')
          .eq('contact_id', contact.id)
          .in('status', ['sent', 'delivered', 'read', 'replied'])
          .gte('sent_at', cutoffIso)
          .limit(1)
          .maybeSingle()

        if (recentSend) {
          await admin
            .from('broadcast_recipients')
            .update({
              status: 'skipped',
              error_message: `Excluded — messaged within the last ${row.exclude_recent_days} day(s)`,
            })
            .eq('id', recipient.id)
          messagesSkipped++
          batchSentDelta++
          continue
        }
      }

      // Deal-status audience filter, re-checked HERE (send time) for the
      // same reason as exclude_recent_days above — a broadcast can
      // trickle out over many batches/days, so a deal that matched
      // deal_status_filter when the recipient list was built may have
      // changed status (or moved out of the stage) by the time this
      // recipient's turn comes up.
      if (row.deal_status_filter && row.stage_id) {
        const { data: matchingDeal } = await admin
          .from('deals')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('stage_id', row.stage_id)
          .eq('status', row.deal_status_filter)
          .limit(1)
          .maybeSingle()

        if (!matchingDeal) {
          await admin
            .from('broadcast_recipients')
            .update({
              status: 'skipped',
              error_message: `Excluded — deal no longer matches status "${row.deal_status_filter}" in the target stage`,
            })
            .eq('id', recipient.id)
          messagesSkipped++
          batchSentDelta++
          continue
        }
      }

      await sleep(randomDelayMs(row.message_delay_min_seconds, row.message_delay_max_seconds))

      // Marks the moment we actually attempt this recipient — the stale-pending
      // sweep below uses it to tell "genuinely stuck after an attempt" apart
      // from "still legitimately queued, hasn't had its turn yet".
      await admin
        .from('broadcast_recipients')
        .update({ last_attempted_at: new Date().toISOString() })
        .eq('id', recipient.id)

      const params = row.template_variables
        ? resolveVariables(row.template_variables, contact, customValueIndex.get(contact.id))
        : []

      let sentMessageId: string | null = null
      let lastError: unknown = null
      for (const variant of phoneVariants(sanitized)) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phoneNumberId,
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

        // Broadcast recipients get the "Disparo" tag (best-effort;
        // no-op if the account has no matching tag) so reports can
        // segment outbound-originated contacts from organic replies.
        await ensureContactTagByName(admin, row.account_id, contact.id, [
          'Disparando',
          'DISPARO',
          'Disparo',
          'Ativo',
        ])

        // User-selected tags (broadcasts.tags_to_add) — applied once
        // per successful send, right here rather than at broadcast
        // creation, since a scheduled/paced broadcast may not actually
        // reach this contact until well after it was created.
        if (Array.isArray(row.tags_to_add) && row.tags_to_add.length > 0) {
          const { error: tagsError } = await admin.from('contact_tags').upsert(
            row.tags_to_add.map((tagId) => ({ contact_id: contact.id, tag_id: tagId })),
            { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
          )
          if (tagsError) {
            console.error('[broadcasts/cron] failed to apply tags_to_add:', tagsError.message)
          }
        }

        // Mirror the send into `messages` so the agent sees it in the
        // inbox conversation — broadcasts previously only touched
        // broadcast_recipients, leaving the customer's conversation
        // with no record the message was ever sent. Best-effort: a
        // missing account owner (shouldn't happen) just skips the
        // mirror rather than failing the send, which already landed.
        const conversationId = configOwnerUserId
          ? await findOrCreateConversationForContact(
              admin,
              row.account_id,
              configOwnerUserId,
              contact.id,
              config.channelId,
            )
          : null
        if (conversationId) {
          const contentText = templateRow?.body_text
            ? renderTemplateText(templateRow.body_text, params)
            : `[template:${row.template_name}]`

          const { error: msgErr } = await admin.from('messages').insert({
            conversation_id: conversationId,
            sender_type: 'agent',
            sender_id: null,
            content_type: 'template',
            content_text: contentText,
            template_name: row.template_name,
            message_id: sentMessageId,
            status: 'sent',
            created_at: new Date().toISOString(),
          })
          if (msgErr) {
            console.error('[broadcasts/cron] failed to save sent message to inbox:', msgErr)
          } else {
            await admin
              .from('conversations')
              .update({
                last_message_text: contentText,
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', conversationId)
          }
        }

        continue
      }

      if (lastError instanceof MetaApiError && lastError.code === RATE_LIMIT_ERROR_CODE) {
        // Meta is rate-limiting this number. Leave this recipient (and
        // everything after it) `pending` and back off the whole
        // broadcast for an hour before trying again.
        rateLimited = true
        rateLimitedRecipientId = recipient.id
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

    // Stale-pending sweep — see STALE_PENDING_MS. Runs every tick for this
    // broadcast regardless of what happened above, so it also cleans up
    // stragglers left over from a previous tick's crash or rate-limit break.
    const { data: staleRecipients } = await admin
      .from('broadcast_recipients')
      .update({
        status: 'failed',
        error_message: 'Tentativa de envio expirou sem confirmação após 1h',
      })
      .eq('broadcast_id', row.id)
      .eq('status', 'pending')
      .not('last_attempted_at', 'is', null)
      .lt('last_attempted_at', new Date(Date.now() - STALE_PENDING_MS).toISOString())
      .select('id')
    if (staleRecipients && staleRecipients.length > 0) {
      messagesFailed += staleRecipients.length
    }

    if (rateLimited) {
      const hits = (row.rate_limit_hits ?? 0) + 1
      if (hits >= RATE_LIMIT_MAX_CONSECUTIVE_HITS && rateLimitedRecipientId) {
        // Same recipient (oldest pending, retried first) has now
        // triggered Meta's rate limit on RATE_LIMIT_MAX_CONSECUTIVE_HITS
        // straight hourly attempts — this is no longer a transient
        // account-wide throttle, it's this recipient blocking everyone
        // behind it. Fail it and move on instead of pausing forever.
        await admin
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: `Meta rate limit (130429) persisted after ${hits} retries`,
          })
          .eq('id', rateLimitedRecipientId)
        await admin
          .from('broadcasts')
          .update({ rate_limit_hits: 0, next_batch_at: nowIso() })
          .eq('id', row.id)
      } else {
        await admin
          .from('broadcasts')
          .update({
            rate_limit_hits: hits,
            next_batch_at: new Date(Date.now() + RATE_LIMIT_PAUSE_MS).toISOString(),
          })
          .eq('id', row.id)
      }
      broadcastsAdvanced++
      continue
    }

    const { count: remainingPending } = await admin
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', row.id)
      .eq('status', 'pending')

    if (!remainingPending) {
      const { data: finished } = await admin
        .from('broadcasts')
        .update({ status: 'sent', next_batch_at: null, rate_limit_hits: 0 })
        .eq('id', row.id)
        .select('sent_count')
        .single()

      // Real Meta cost, computed from the account's configured rates
      // (see meta_pricing / settings > WhatsApp) now that the send is
      // done and sent_count is final. Best-effort: a pricing lookup
      // failure shouldn't leave the broadcast stuck mid-completion.
      try {
        await computeAndSaveBroadcastCost(admin, {
          broadcastId: row.id,
          accountId: row.account_id,
          templateCategory: templateRow?.category ?? null,
          sentCount: finished?.sent_count ?? 0,
        })
      } catch (err) {
        console.error('[broadcasts/cron] cost calculation failed:', err)
      }
    } else {
      const newBatchSent = row.current_batch_sent + batchSentDelta
      let updatedSentCount: number | null = null
      if (newBatchSent >= row.batch_size) {
        let pauseUntil = new Date(Date.now() + row.batch_interval_minutes * 60 * 1000)
        if (row.respect_business_hours && !isWithinBusinessHours(pauseUntil)) {
          pauseUntil = nextBusinessHoursStart(pauseUntil)
        }
        const { data: updated } = await admin
          .from('broadcasts')
          .update({
            current_batch: row.current_batch + 1,
            current_batch_sent: 0,
            next_batch_at: pauseUntil.toISOString(),
            rate_limit_hits: 0,
          })
          .eq('id', row.id)
          .select('sent_count')
          .single()
        updatedSentCount = updated?.sent_count ?? null
      } else {
        const { data: updated } = await admin
          .from('broadcasts')
          .update({
            current_batch_sent: newBatchSent,
            next_batch_at: nowIso(),
            rate_limit_hits: 0,
          })
          .eq('id', row.id)
          .select('sent_count')
          .single()
        updatedSentCount = updated?.sent_count ?? null
      }

      // Incremental cost update — runs after every batch that made
      // real progress, not just once at the very end, so meta_total_cost
      // tracks spend as the broadcast goes out instead of sitting at R$0
      // for however long the broadcast takes to fully complete.
      if (batchSentDelta > 0 && updatedSentCount !== null) {
        try {
          await computeAndSaveBroadcastCost(admin, {
            broadcastId: row.id,
            accountId: row.account_id,
            templateCategory: templateRow?.category ?? null,
            sentCount: updatedSentCount,
          })
        } catch (err) {
          console.error('[broadcasts/cron] incremental cost calculation failed:', err)
        }
      }
    }
    broadcastsAdvanced++
  }

  return NextResponse.json({ broadcastsAdvanced, messagesSent, messagesFailed, messagesSkipped })
}
