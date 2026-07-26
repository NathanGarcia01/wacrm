import type { SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

// ============================================================
// Shared inbound-message building blocks — originally private to the
// Meta Cloud API webhook (src/app/api/whatsapp/webhook/route.ts).
// Extracted so the Evolution API webhook
// (src/app/api/whatsapp/evolution-webhook/route.ts) can reuse the
// exact same "find/create contact + conversation, auto-open a deal on
// first contact" logic — a lead's very first message should behave
// the same in the CRM whether it arrived via Meta or via a QR-code
// number.
//
// Deliberately NOT extracted (stayed in the Meta webhook, channel-
// specific enough that duplicating a thin dispatch is preferable to a
// leaky shared abstraction): media download through Meta's Graph API,
// NPS survey matching, broadcast reply/button-click correlation.
// Every function here takes `admin` as a parameter rather than
// constructing its own client, so each webhook route keeps using its
// own module-local supabaseAdmin() singleton.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

export interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row — callers use this to decide
   *  whether to fire a `new_contact_created` automation trigger. */
  wasCreated: boolean
}

export async function findOrCreateContact(
  admin: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  // Find an existing contact for this account by phone. The shared
  // helper pre-filters in SQL by the last-8-digit suffix (so we don't
  // pull every contact on every inbound message) then applies the
  // strict `phonesMatch` in JS on the small candidate set. The same
  // helper backs the manual contact form and CSV import, so all three
  // paths agree on what "same number" means (issue #212).
  const existingContact = await findExistingContact(admin, accountId, phone)

  if (existingContact) {
    // Deliberately does NOT sync `name` from the WhatsApp profile name
    // here — see the Meta webhook's original comment (bug #4): the
    // contact record is the source of truth once it exists; only the
    // initial insert below seeds name from the inbound profile name.
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact. account_id is the tenancy column; user_id is
  // the NOT NULL FK audit column (no inbound message has a single
  // "user who created" it — we attribute to the channel's account
  // owner as a stable default).
  const { data: newContact, error: createError } = await admin
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
      const raced = await findExistingContact(admin, accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

export async function findOrCreateConversation(
  admin: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  // Which whatsapp_channels row received the message that triggered
  // this lookup. Null (legacy whatsapp_config fallback, Meta-only)
  // leaves an existing conversation's channel_id untouched rather than
  // clearing it — only a resolved channel ever overwrites it.
  channelId: string | null,
) {
  // Look for existing conversation in this account
  const { data: existing, error: findError } = await admin
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    // Keep channel_id current — a contact may start messaging a
    // different number/channel than the one that first created this
    // conversation, and the inbox badge should reflect the latest one.
    if (channelId && existing.channel_id !== channelId) {
      const { data: updated, error: updateError } = await admin
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
  const { data: newConv, error: createError } = await admin
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

/**
 * A contact's very first-ever inbound message gets a live card on the
 * pipeline — covers both a brand-new contact and one whose row already
 * existed (CSV-imported, added as broadcast audience) but never
 * messaged before. Callers MUST gate this on "is this really the
 * first inbound message" — an existing contact who already has a
 * history and just sends another reply must NOT get a deal
 * auto-created (see commit 13e8331, which reverted that over-eager
 * behavior).
 *
 * Title is the contact's name, falling back to their phone when no
 * name is on file — never a generic placeholder like "Novo Lead".
 *
 * Best-effort: failures here must not break the main inbound-message
 * flow, so errors are swallowed with a log.
 */
export async function ensureOpenDealForContact(
  admin: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  contactName: string,
  contactPhone: string,
) {
  try {
    const { data: existingOpenDeal, error: existingErr } = await admin
      .from('deals')
      .select('id')
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (existingErr) {
      console.error('[inbound-message] open-deal lookup failed:', existingErr.message)
      return
    }
    if (existingOpenDeal) return // already has one — never duplicate

    const { data: defaultPipeline, error: pipelineErr } = await admin
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pipelineErr || !defaultPipeline) return // no pipeline to file it under

    const { data: firstStage, error: stageErr } = await admin
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', defaultPipeline.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (stageErr || !firstStage) return // pipeline has no stages yet

    const { error: insertErr } = await admin.from('deals').insert({
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
      console.error('[inbound-message] failed to auto-create deal:', insertErr.message)
    }
  } catch (err) {
    console.error('ensureOpenDealForContact failed:', err)
  }
}
