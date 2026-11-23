// ============================================================
// Lead capture — the core logic shared by the public webhook
// (POST /api/v1/webhooks/in/[token]) and the "disparar lead de teste"
// button. Pure data-access, no HTTP/auth concerns — those live in
// the route.
//
// Contact dedup reuses `@/lib/contacts/dedupe` (the same helpers the
// WhatsApp webhook, the manual contact form, and CSV import already
// agree on — issue #212), so "same phone number" means the same
// thing everywhere in the app. Deal creation mirrors the `create_deal`
// automation step (src/lib/automations/engine.ts): one open deal per
// contact, account's default_currency, title falls back to the
// contact's own name/phone.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation, type ExistingContact } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export interface LeadSourceConfig {
  accountId: string
  pipelineId: string
  stageId: string
  leadOriginId: string | null
  /** Who configured the source — used as `contacts.user_id`/
   *  `deals.user_id` (both NOT NULL legacy "owner" columns). Falls
   *  back to the account owner if the creator was later removed. */
  createdBy: string | null
}

export interface LeadCapturePayload {
  phone: string
  name?: string | null
  email?: string | null
  company?: string | null
}

export interface LeadCaptureResult {
  status: 'ok' | 'error'
  contactId?: string
  contactOutcome?: 'created' | 'matched'
  dealId?: string
  dealOutcome?: 'created' | 'skipped_duplicate'
  errorMessage?: string
}

async function resolveOwnerId(db: SupabaseClient, source: LeadSourceConfig): Promise<string | null> {
  if (source.createdBy) return source.createdBy
  const { data } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', source.accountId)
    .eq('account_role', 'owner')
    .limit(1)
    .maybeSingle()
  return (data?.user_id as string | undefined) ?? null
}

/**
 * Create-or-match the contact, then create the deal in the source's
 * configured pipeline/stage. Never throws — failures come back as
 * `{ status: 'error', errorMessage }` so the caller can log the
 * attempt either way (lead_source_events has no "it crashed" gap).
 */
export async function captureLead(
  db: SupabaseClient,
  source: LeadSourceConfig,
  payload: LeadCapturePayload,
): Promise<LeadCaptureResult> {
  const phone = (payload.phone ?? '').trim()
  if (!phone || normalizePhone(phone).length < 8) {
    return { status: 'error', errorMessage: 'telefone ausente ou inválido' }
  }

  const ownerId = await resolveOwnerId(db, source)
  if (!ownerId) {
    return { status: 'error', errorMessage: 'não foi possível determinar o responsável pela conta' }
  }

  let contactId: string
  let contactOutcome: 'created' | 'matched'

  const existing = await findExistingContact(db, source.accountId, phone)
  if (existing) {
    contactId = existing.id
    contactOutcome = 'matched'
    await enrichExistingContact(db, existing, source, payload)
  } else {
    const inserted = await insertContact(db, source, ownerId, phone, payload)
    if (inserted.error) {
      if (!isUniqueViolation(inserted.error)) {
        return { status: 'error', errorMessage: (inserted.error as { message?: string }).message ?? 'falha ao criar contato' }
      }
      // Corrida: outra requisição criou o mesmo telefone entre o
      // findExistingContact e este insert — busca de novo em vez de
      // falhar (o índice único em (account_id, phone_normalized) é
      // quem garante que isto é seguro).
      const retried = await findExistingContact(db, source.accountId, phone)
      if (!retried) return { status: 'error', errorMessage: 'falha ao criar contato (condição de corrida)' }
      contactId = retried.id
      contactOutcome = 'matched'
    } else {
      contactId = inserted.id!
      contactOutcome = 'created'
    }
  }

  const dealResult = await createDealIfNeeded(db, source, ownerId, contactId, payload)
  if (dealResult.dealOutcome === 'created') {
    return { status: 'ok', contactId, contactOutcome, dealId: dealResult.dealId, dealOutcome: 'created' }
  }
  if (dealResult.dealOutcome === 'skipped_duplicate') {
    return { status: 'ok', contactId, contactOutcome, dealOutcome: 'skipped_duplicate' }
  }
  // Deal creation failed — contact capture still succeeded, so this
  // stays `status: 'ok'` with the problem surfaced in errorMessage
  // rather than discarding the contact outcome.
  return { status: 'ok', contactId, contactOutcome, errorMessage: dealResult.errorMessage }
}

async function enrichExistingContact(
  db: SupabaseClient,
  existing: ExistingContact,
  source: LeadSourceConfig,
  payload: LeadCapturePayload,
): Promise<void> {
  // Additive only — never overwrites data already in the CRM with
  // whatever a form/ad platform happens to send.
  const patch: Record<string, unknown> = {}
  if (!existing.name && payload.name) patch.name = payload.name
  if (!existing.email && payload.email) patch.email = payload.email
  if (!existing.company && payload.company) patch.company = payload.company
  if (!existing.lead_origin_id && source.leadOriginId) patch.lead_origin_id = source.leadOriginId
  if (Object.keys(patch).length === 0) return
  await db.from('contacts').update(patch).eq('id', existing.id)
}

async function insertContact(
  db: SupabaseClient,
  source: LeadSourceConfig,
  ownerId: string,
  phone: string,
  payload: LeadCapturePayload,
): Promise<{ id?: string; error?: unknown }> {
  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: source.accountId,
      user_id: ownerId,
      phone,
      name: payload.name?.trim() || null,
      email: payload.email?.trim() || null,
      company: payload.company?.trim() || null,
      lead_origin_id: source.leadOriginId,
    })
    .select('id')
    .single()
  if (error) return { error }
  return { id: data!.id as string }
}

async function createDealIfNeeded(
  db: SupabaseClient,
  source: LeadSourceConfig,
  ownerId: string,
  contactId: string,
  payload: LeadCapturePayload,
): Promise<{ dealId?: string; dealOutcome?: 'created' | 'skipped_duplicate'; errorMessage?: string }> {
  // Mirrors create_deal's duplicate guard (engine.ts) — a contact
  // that already has an open deal doesn't get a second one every
  // time the same lead retries the webhook.
  const { data: existingOpenDeal } = await db
    .from('deals')
    .select('id')
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .maybeSingle()
  if (existingOpenDeal) return { dealOutcome: 'skipped_duplicate' }

  const { data: acct } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', source.accountId)
    .maybeSingle()

  const { data: contact } = await db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
  const title = payload.name?.trim() || contact?.name || contact?.phone || 'Novo lead'

  const { data: deal, error } = await db
    .from('deals')
    .insert({
      account_id: source.accountId,
      user_id: ownerId,
      pipeline_id: source.pipelineId,
      stage_id: source.stageId,
      contact_id: contactId,
      title,
      value: 0,
      currency: acct?.default_currency ?? 'USD',
    })
    .select('id')
    .single()

  if (error) return { errorMessage: `negócio não criado: ${error.message}` }
  return { dealId: deal!.id as string, dealOutcome: 'created' }
}
