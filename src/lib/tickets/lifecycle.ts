/**
 * Fase 1 (atendimento) — Etapa 3: ticket lifecycle rules.
 *
 * Pure server-side logic, no UI, not wired into the webhook or send
 * route yet (that's Etapa 4) — this module only exposes the primitives
 * those call sites will use:
 *
 *   - openTicketIfNeeded / resolveInboundTicketAttribution: opening.
 *   - recordAgentReply: first_response_at.
 *   - assignTicket / transferTicket / returnToQueue / closeTicket: the
 *     four actions, each writing its own ticket_events row.
 *
 * Contract every caller (Etapa 4 and beyond) must respect:
 *   - A broadcast/campaign send, an automation send, and a flow send
 *     must NEVER call openTicketIfNeeded. Only an inbound customer
 *     message or a manually-sent agent message does — see
 *     resolveInboundTicketAttribution for the inbound case.
 *   - Everything here runs via the service-role client (supabaseAdmin
 *     from ./admin-client), never the RLS-scoped per-request one —
 *     callers are trusted server contexts that already know which
 *     account/actor they're acting for.
 */

import type {
  SenderType,
  Ticket,
  TicketClosedBy,
  TicketEventType,
  TicketInitiatedBy,
  TicketSource,
} from '@/types'
import { supabaseAdmin } from './admin-client'

/**
 * How far back an inbound reply can still be attributed to a broadcast
 * send ("campanha") rather than counted as organic inbound. Exported so
 * a future Settings UI (or a test) can read/override it without digging
 * into this file.
 */
export const CAMPAIGN_ATTRIBUTION_WINDOW_HOURS = 72

export class TicketNotFoundError extends Error {
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} not found`)
  }
}

export class TicketClosedError extends Error {
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} is already closed`)
  }
}

export class TicketAccountMismatchError extends Error {
  constructor(actorId: string, accountId: string) {
    super(`Actor ${actorId} does not belong to account ${accountId}`)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

// ------------------------------------------------------------
// Opening
// ------------------------------------------------------------

export interface OpenTicketInput {
  source: TicketSource
  initiatedBy: TicketInitiatedBy
  campaignId?: string | null
  actorId?: string | null
  /**
   * When this ticket opens as a direct result of a specific message
   * (always, in practice), pass that message's `created_at` here so
   * `opened_at` matches it exactly. recordAgentReply() below uses a
   * strict `createdAt > opened_at` comparison to skip exactly that
   * opening message when initiatedBy='company' — if this drifted from
   * the real message timestamp (e.g. defaulted to `now()` while the
   * message row was inserted a moment earlier), that comparison could
   * misfire. Defaults to `now()` only for callers with no message
   * timestamp at hand (e.g. tests).
   */
  occurredAt?: string
}

export interface OpenTicketResult {
  ticket: Ticket
  /** False when an existing open ticket for this conversation was
   *  returned instead of a new one being created (idempotent path). */
  created: boolean
}

/**
 * Opens a ticket for `conversationId` unless one is already open
 * (status <> 'closed'). Idempotent under concurrency via the partial
 * unique index on tickets(conversation_id) WHERE status <> 'closed'
 * (migration 070): if two callers race, the loser's INSERT fails with
 * a unique_violation and this falls back to fetching the winner's row
 * instead of erroring.
 *
 * Never call this for a campaign/broadcast send, an automation send,
 * or a flow send — see the module doc comment.
 */
export async function openTicketIfNeeded(
  conversationId: string,
  input: OpenTicketInput,
): Promise<OpenTicketResult> {
  const admin = supabaseAdmin()
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const campaignId = input.campaignId ?? null

  const { data: conversation, error: convError } = await admin
    .from('conversations')
    .select('account_id')
    .eq('id', conversationId)
    .single()
  if (convError || !conversation) {
    throw convError ?? new Error(`Conversation ${conversationId} not found`)
  }
  const accountId = conversation.account_id as string

  // Burned on a losing race below — accepted gap, same tradeoff as any
  // sequence-backed numbering scheme under concurrency. Not worth the
  // complexity of "returning" an unused number.
  const protocolNumber = await nextTicketProtocol(admin, accountId)

  const { data: inserted, error: insertError } = await admin
    .from('tickets')
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      protocol_number: protocolNumber,
      status: 'pending',
      initiated_by: input.initiatedBy,
      source: input.source,
      campaign_id: campaignId,
      opened_at: occurredAt,
    })
    .select('*')
    .single()

  if (!insertError && inserted) {
    await writeTicketEvent(admin, {
      ticketId: inserted.id,
      accountId,
      type: 'opened',
      actorId: input.actorId ?? null,
      metadata: { source: input.source, initiated_by: input.initiatedBy, campaign_id: campaignId },
    })
    return { ticket: inserted as Ticket, created: true }
  }

  if (!isUniqueViolation(insertError)) {
    throw insertError
  }

  const { data: existing, error: fetchError } = await admin
    .from('tickets')
    .select('*')
    .eq('conversation_id', conversationId)
    .neq('status', 'closed')
    .single()
  if (fetchError || !existing) {
    throw fetchError ?? new Error(`Lost the race for conversation ${conversationId} but found no open ticket`)
  }
  return { ticket: existing as Ticket, created: false }
}

export interface InboundTicketAttribution {
  source: TicketSource
  campaignId: string | null
}

/**
 * Rule for an inbound customer message with no ticket open yet: if the
 * conversation's contact was sent a broadcast that actually went out
 * (sent_at set) within CAMPAIGN_ATTRIBUTION_WINDOW_HOURS, attribute the
 * reply to that campaign; otherwise it's plain organic inbound.
 *
 * Deliberately does not attempt to detect "replied to an automation
 * send" — source='automation' exists in the schema for that, but no
 * rule for populating it was specified yet; nothing sets it today.
 */
export async function resolveInboundTicketAttribution(
  conversationId: string,
): Promise<InboundTicketAttribution> {
  const admin = supabaseAdmin()

  const { data: conversation, error } = await admin
    .from('conversations')
    .select('contact_id')
    .eq('id', conversationId)
    .single()
  if (error || !conversation) {
    throw error ?? new Error(`Conversation ${conversationId} not found`)
  }
  const contactId = conversation.contact_id as string | null
  if (!contactId) {
    return { source: 'inbound', campaignId: null }
  }

  const cutoff = new Date(Date.now() - CAMPAIGN_ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const { data: recipient, error: recipientError } = await admin
    .from('broadcast_recipients')
    .select('broadcast_id, sent_at')
    .eq('contact_id', contactId)
    .not('sent_at', 'is', null)
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recipientError) throw recipientError

  if (recipient?.broadcast_id) {
    return { source: 'campaign', campaignId: recipient.broadcast_id as string }
  }
  return { source: 'inbound', campaignId: null }
}

// ------------------------------------------------------------
// first_response_at
// ------------------------------------------------------------

export interface AgentReplyMessage {
  senderType: SenderType
  createdAt: string
  /** Meta message id, when available — used to recognize a broadcast
   *  mirror (sender_type='agent' in `messages`, same as a real human
   *  reply) via a matching broadcast_recipients.whatsapp_message_id row. */
  messageId?: string | null
}

/**
 * Fills first_response_at on the conversation's current open ticket,
 * at most once, the first time it sees a message that is all of:
 *   - sender_type = 'agent' (excludes 'customer' and 'bot' — bot
 *     covers automation and flow sends, see src/lib/automations/meta-send.ts
 *     and src/lib/flows/meta-send.ts)
 *   - strictly after the ticket's opened_at (excludes the exact
 *     message that opened the ticket when initiatedBy='company' —
 *     see OpenTicketInput.occurredAt)
 *   - not a broadcast mirror (sender_type='agent' too, but tagged by
 *     a matching broadcast_recipients.whatsapp_message_id row — see
 *     src/app/api/broadcasts/cron/route.ts, which has no other marker
 *     distinguishing it from a real agent reply)
 *
 * No-ops silently (no error) when there's no open ticket, or it
 * already has a first_response_at — both are expected, not bugs.
 */
export async function recordAgentReply(conversationId: string, message: AgentReplyMessage): Promise<void> {
  if (message.senderType !== 'agent') return

  const admin = supabaseAdmin()

  const { data: ticket, error } = await admin
    .from('tickets')
    .select('*')
    .eq('conversation_id', conversationId)
    .neq('status', 'closed')
    .single()
  if (error || !ticket) return
  if (ticket.first_response_at) return
  if (new Date(message.createdAt).getTime() <= new Date(ticket.opened_at).getTime()) return

  if (message.messageId) {
    const { data: broadcastMirror, error: brError } = await admin
      .from('broadcast_recipients')
      .select('id')
      .eq('whatsapp_message_id', message.messageId)
      .maybeSingle()
    if (brError) throw brError
    if (broadcastMirror) return
  }

  // Guard the write with `.is('first_response_at', null)` too — belt
  // and suspenders against two concurrent agent replies both passing
  // the check above before either writes.
  await admin
    .from('tickets')
    .update({ first_response_at: message.createdAt })
    .eq('id', ticket.id)
    .is('first_response_at', null)
  // No ticket_event: 'first_response' isn't one of the type values the
  // ticket_events CHECK constraint (migration 070) allows, and nothing
  // asked for one — the timestamp on `tickets` is the record of this.
}

// ------------------------------------------------------------
// Shared helpers for the four actions below
// ------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTicketOrThrow(admin: any, ticketId: string): Promise<Ticket> {
  const { data, error } = await admin.from('tickets').select('*').eq('id', ticketId).single()
  if (error || !data) throw new TicketNotFoundError(ticketId)
  return data as Ticket
}

async function assertActorBelongsToAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  accountId: string,
  actorId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', actorId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.account_id !== accountId) {
    throw new TicketAccountMismatchError(actorId, accountId)
  }
}

interface WriteTicketEventInput {
  ticketId: string
  accountId: string
  type: TicketEventType
  actorId?: string | null
  fromAgentId?: string | null
  toAgentId?: string | null
  fromDepartmentId?: string | null
  toDepartmentId?: string | null
  metadata?: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeTicketEvent(admin: any, input: WriteTicketEventInput): Promise<void> {
  const { error } = await admin.from('ticket_events').insert({
    ticket_id: input.ticketId,
    account_id: input.accountId,
    type: input.type,
    from_agent_id: input.fromAgentId ?? null,
    to_agent_id: input.toAgentId ?? null,
    from_department_id: input.fromDepartmentId ?? null,
    to_department_id: input.toDepartmentId ?? null,
    actor_id: input.actorId ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) throw error
}

async function nextTicketProtocol(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  accountId: string,
): Promise<number> {
  const { data, error } = await admin.rpc('next_ticket_protocol', { p_account_id: accountId })
  if (error) throw error
  return data as number
}

// ------------------------------------------------------------
// The four actions
// ------------------------------------------------------------

/** Assigns (or reassigns) a ticket to a specific agent. Moves status to
 *  'in_progress' — assigning is "someone is now on it". */
export async function assignTicket(ticketId: string, agentId: string, actorId: string): Promise<Ticket> {
  const admin = supabaseAdmin()
  const ticket = await loadTicketOrThrow(admin, ticketId)
  await assertActorBelongsToAccount(admin, ticket.account_id, actorId)
  if (ticket.status === 'closed') throw new TicketClosedError(ticketId)

  const { data: updated, error } = await admin
    .from('tickets')
    .update({ assigned_agent_id: agentId, status: 'in_progress' })
    .eq('id', ticketId)
    .select('*')
    .single()
  if (error || !updated) throw error ?? new Error(`Failed to assign ticket ${ticketId}`)

  await writeTicketEvent(admin, {
    ticketId,
    accountId: ticket.account_id,
    type: 'assigned',
    actorId,
    fromAgentId: ticket.assigned_agent_id ?? null,
    toAgentId: agentId,
  })
  return updated as Ticket
}

export interface TransferTicketTarget {
  toAgentId?: string | null
  toDepartmentId?: string | null
}

/** Moves a ticket to a different agent and/or department. At least one
 *  of toAgentId/toDepartmentId must be provided — passing neither isn't
 *  a transfer (use returnToQueue to unassign without a department
 *  change). Also moves status to 'in_progress'. */
export async function transferTicket(
  ticketId: string,
  target: TransferTicketTarget,
  actorId: string,
): Promise<Ticket> {
  if (target.toAgentId === undefined && target.toDepartmentId === undefined) {
    throw new Error('transferTicket requires toAgentId and/or toDepartmentId')
  }

  const admin = supabaseAdmin()
  const ticket = await loadTicketOrThrow(admin, ticketId)
  await assertActorBelongsToAccount(admin, ticket.account_id, actorId)
  if (ticket.status === 'closed') throw new TicketClosedError(ticketId)

  const update: Record<string, unknown> = { status: 'in_progress' }
  if (target.toAgentId !== undefined) update.assigned_agent_id = target.toAgentId
  if (target.toDepartmentId !== undefined) update.department_id = target.toDepartmentId

  const { data: updated, error } = await admin
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select('*')
    .single()
  if (error || !updated) throw error ?? new Error(`Failed to transfer ticket ${ticketId}`)

  await writeTicketEvent(admin, {
    ticketId,
    accountId: ticket.account_id,
    type: 'transferred',
    actorId,
    fromAgentId: ticket.assigned_agent_id ?? null,
    toAgentId: target.toAgentId ?? null,
    fromDepartmentId: ticket.department_id ?? null,
    toDepartmentId: target.toDepartmentId ?? null,
  })
  return updated as Ticket
}

/** Unassigns the ticket and sends it back to 'pending' — the queue, not
 *  any specific department (department_id is left untouched; the
 *  ticket stays in whichever department it was in, just unclaimed). */
export async function returnToQueue(ticketId: string, actorId: string): Promise<Ticket> {
  const admin = supabaseAdmin()
  const ticket = await loadTicketOrThrow(admin, ticketId)
  await assertActorBelongsToAccount(admin, ticket.account_id, actorId)
  if (ticket.status === 'closed') throw new TicketClosedError(ticketId)

  const { data: updated, error } = await admin
    .from('tickets')
    .update({ assigned_agent_id: null, status: 'pending' })
    .eq('id', ticketId)
    .select('*')
    .single()
  if (error || !updated) throw error ?? new Error(`Failed to return ticket ${ticketId} to queue`)

  await writeTicketEvent(admin, {
    ticketId,
    accountId: ticket.account_id,
    type: 'returned',
    actorId,
    fromAgentId: ticket.assigned_agent_id ?? null,
    toAgentId: null,
  })
  return updated as Ticket
}

/**
 * Closes a ticket. `closingReasonId` is required — the DB CHECK on
 * `tickets` (migration 070) would reject the UPDATE without one
 * anyway, but failing here first gives a clearer error than a Postgres
 * constraint-violation message.
 *
 * `actorId` null means a system close (the future auto-close-on-
 * inactivity job) — closed_by is derived from that, not passed
 * separately, so the two can never disagree.
 *
 * Closing is final: this never "reopens" anything. A later message on
 * the same conversation calls openTicketIfNeeded and gets a brand new
 * ticket row (the partial unique index only blocks a second *open*
 * ticket, and this one is now closed).
 */
export async function closeTicket(
  ticketId: string,
  closingReasonId: string,
  actorId: string | null,
  note?: string,
): Promise<Ticket> {
  if (!closingReasonId) throw new Error('closeTicket requires closingReasonId')

  const admin = supabaseAdmin()
  const ticket = await loadTicketOrThrow(admin, ticketId)
  if (actorId != null) await assertActorBelongsToAccount(admin, ticket.account_id, actorId)
  if (ticket.status === 'closed') throw new TicketClosedError(ticketId)

  const { data: reason, error: reasonError } = await admin
    .from('closing_reasons')
    .select('id, account_id')
    .eq('id', closingReasonId)
    .maybeSingle()
  if (reasonError) throw reasonError
  if (!reason || reason.account_id !== ticket.account_id) {
    throw new Error(`Closing reason ${closingReasonId} does not belong to account ${ticket.account_id}`)
  }

  const closedBy: TicketClosedBy = actorId == null ? 'system' : 'agent'

  const { data: updated, error } = await admin
    .from('tickets')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      closing_reason_id: closingReasonId,
      closing_note: note ?? null,
    })
    .eq('id', ticketId)
    .select('*')
    .single()
  if (error || !updated) throw error ?? new Error(`Failed to close ticket ${ticketId}`)

  await writeTicketEvent(admin, {
    ticketId,
    accountId: ticket.account_id,
    type: 'closed',
    actorId,
    metadata: { closing_reason_id: closingReasonId, closed_by: closedBy },
  })
  return updated as Ticket
}
