import { describe, it, expect, beforeEach, vi } from 'vitest'

// Shared fake-DB state for the mocked service-role client. Hoisted so
// the vi.mock factory below (and every test's setup/assertions) can
// close over the same object. Mirrors the convention in
// src/lib/automations/engine.test.ts.
const h = vi.hoisted(() => ({
  state: {
    conversations: {} as Record<string, { account_id: string; contact_id: string | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tickets: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broadcastRecipients: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ticketEvents: [] as any[],
    profiles: {} as Record<string, { account_id: string }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    closingReasons: [] as any[],
    protocolCounters: {} as Record<string, number>,
    nextTicketId: 1,
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h

  type Filter = [string, string, unknown?]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getEq(filters: Filter[], col: string): any {
    return filters.find((f) => f[0] === 'eq' && f[1] === col)?.[2]
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getNeq(filters: Filter[], col: string): any {
    return filters.find((f) => f[0] === 'neq' && f[1] === col)?.[2]
  }
  function hasIsNull(filters: Filter[], col: string): boolean {
    return filters.some((f) => f[0] === 'is' && f[1] === col && f[2] === null)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getGte(filters: Filter[], col: string): any {
    return filters.find((f) => f[0] === 'gte' && f[1] === col)?.[2]
  }

  function resolve(ops: {
    table: string
    type: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any
    filters: Filter[]
    /** Set only by .maybeSingle() — zero matching rows is a normal,
     *  no-error result there, unlike .single(). */
    maybe?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): { data: any; error: any } {
    const { table, type, payload, filters, maybe } = ops

    if (table === 'conversations') {
      const id = getEq(filters, 'id')
      const conv = state.conversations[id]
      return conv ? { data: conv, error: null } : { data: null, error: { message: 'conversation not found' } }
    }

    if (table === 'tickets') {
      if (type === 'insert') {
        const conflict = state.tickets.some(
          (t) => t.conversation_id === payload.conversation_id && t.status !== 'closed',
        )
        if (conflict) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_tickets_conversation_open"' },
          }
        }
        const row = {
          id: `ticket-${state.nextTicketId++}`,
          account_id: payload.account_id,
          conversation_id: payload.conversation_id,
          protocol_number: payload.protocol_number,
          status: payload.status,
          initiated_by: payload.initiated_by,
          source: payload.source,
          campaign_id: payload.campaign_id ?? null,
          assigned_agent_id: null,
          department_id: null,
          opened_at: payload.opened_at,
          first_response_at: null,
          closed_at: null,
          closing_reason_id: null,
          closing_note: null,
          closed_by: null,
          created_at: payload.opened_at,
        }
        state.tickets.push(row)
        return { data: row, error: null }
      }

      if (type === 'update') {
        const id = getEq(filters, 'id')
        const ticket = state.tickets.find((t) => t.id === id)
        if (!ticket) return { data: null, error: { message: 'ticket not found' } }
        if (hasIsNull(filters, 'first_response_at') && ticket.first_response_at !== null) {
          // WHERE first_response_at IS NULL matched zero rows — no-op.
          return { data: null, error: null }
        }
        Object.assign(ticket, payload)
        return { data: ticket, error: null }
      }

      // select — return copies, never the live state.tickets reference,
      // so a later `update` (which mutates the stored row in place)
      // can't retroactively change a row a caller already read earlier
      // in the same action (e.g. the "from" side of an assign/transfer).
      const id = getEq(filters, 'id')
      if (id !== undefined) {
        const ticket = state.tickets.find((t) => t.id === id)
        if (ticket) return { data: { ...ticket }, error: null }
        return maybe ? { data: null, error: null } : { data: null, error: { message: 'ticket not found' } }
      }
      const conversationId = getEq(filters, 'conversation_id')
      if (conversationId !== undefined) {
        const neqStatus = getNeq(filters, 'status')
        const matches = state.tickets.filter(
          (t) => t.conversation_id === conversationId && (neqStatus === undefined || t.status !== neqStatus),
        )
        const row = matches[matches.length - 1] ?? null
        if (row) return { data: { ...row }, error: null }
        return maybe ? { data: null, error: null } : { data: null, error: { message: 'ticket not found' } }
      }
      return { data: null, error: { message: 'unsupported tickets query in test mock' } }
    }

    if (table === 'broadcast_recipients') {
      const whatsappMessageId = getEq(filters, 'whatsapp_message_id')
      if (whatsappMessageId !== undefined) {
        const row = state.broadcastRecipients.find((r) => r.whatsapp_message_id === whatsappMessageId)
        return { data: row ?? null, error: null }
      }
      const contactId = getEq(filters, 'contact_id')
      const cutoff = getGte(filters, 'sent_at')
      let matches = state.broadcastRecipients.filter((r) => r.contact_id === contactId && r.sent_at != null)
      if (cutoff !== undefined) matches = matches.filter((r) => r.sent_at >= cutoff)
      matches = [...matches].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))
      return { data: matches[0] ?? null, error: null }
    }

    if (table === 'profiles') {
      const userId = getEq(filters, 'user_id')
      return { data: state.profiles[userId] ?? null, error: null }
    }

    if (table === 'closing_reasons') {
      const id = getEq(filters, 'id')
      if (id !== undefined) {
        const row = state.closingReasons.find((r) => r.id === id)
        return { data: row ?? null, error: null }
      }
      const accountId = getEq(filters, 'account_id')
      const isSystem = getEq(filters, 'is_system')
      const systemKey = getEq(filters, 'system_key')
      const row = state.closingReasons.find(
        (r) =>
          r.account_id === accountId &&
          (isSystem === undefined || r.is_system === isSystem) &&
          (systemKey === undefined || r.system_key === systemKey),
      )
      return { data: row ?? null, error: null }
    }

    if (table === 'ticket_events') {
      if (type === 'insert') {
        state.ticketEvents.push(payload)
        return { data: null, error: null }
      }
    }

    return { data: null, error: { message: `unsupported table ${table} in test mock` } }
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: undefined as any,
      filters: [] as Filter[],
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {
      select: () => b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: (p: any) => ((ops.type = 'insert'), (ops.payload = p), b),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: (p: any) => ((ops.type = 'update'), (ops.payload = p), b),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eq: (k: string, v: any) => (ops.filters.push(['eq', k, v]), b),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      neq: (k: string, v: any) => (ops.filters.push(['neq', k, v]), b),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      not: (k: string, _op: string, v: any) => (ops.filters.push(['not', k, v]), b),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gte: (k: string, v: any) => (ops.filters.push(['gte', k, v]), b),
      order: () => b,
      limit: () => b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      is: (k: string, v: any) => (ops.filters.push(['is', k, v]), b),
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve({ ...ops, maybe: true })),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rpc: (name: string, params: any) => {
        if (name === 'next_ticket_protocol') {
          const accountId = params.p_account_id
          const next = (state.protocolCounters[accountId] ?? 0) + 1
          state.protocolCounters[accountId] = next
          return Promise.resolve({ data: next, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }
})

import {
  CAMPAIGN_ATTRIBUTION_WINDOW_HOURS,
  TicketAccountMismatchError,
  TicketClosedError,
  assignTicket,
  closeTicket,
  closeTicketWithoutReason,
  findOpenTicket,
  openTicketIfNeeded,
  recordAgentReply,
  resolveInboundTicketAttribution,
  returnToQueue,
  transferTicket,
} from './lifecycle'

const ACCOUNT = 'acct-1'
const OTHER_ACCOUNT = 'acct-2'
const CONVERSATION = 'conv-1'
const CONTACT = 'contact-1'
const AGENT = 'agent-1'
const OTHER_AGENT = 'agent-2'
const ACTOR_OTHER_ACCOUNT = 'actor-outsider'
const DEPARTMENT = 'dept-1'
const CLOSING_REASON = 'reason-1'
const OTHER_ACCOUNT_REASON = 'reason-other-account'
const NO_REASON_SYSTEM_REASON = 'reason-system-no-reason'

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  h.state.conversations = {
    [CONVERSATION]: { account_id: ACCOUNT, contact_id: CONTACT },
  }
  h.state.tickets = []
  h.state.broadcastRecipients = []
  h.state.ticketEvents = []
  h.state.profiles = {
    [AGENT]: { account_id: ACCOUNT },
    [OTHER_AGENT]: { account_id: ACCOUNT },
    [ACTOR_OTHER_ACCOUNT]: { account_id: OTHER_ACCOUNT },
  }
  h.state.closingReasons = [
    { id: CLOSING_REASON, account_id: ACCOUNT, is_system: false, system_key: null },
    { id: OTHER_ACCOUNT_REASON, account_id: OTHER_ACCOUNT, is_system: false, system_key: null },
    { id: NO_REASON_SYSTEM_REASON, account_id: ACCOUNT, is_system: true, system_key: 'no_reason_informed' },
  ]
  h.state.protocolCounters = {}
  h.state.nextTicketId = 1
})

describe('openTicketIfNeeded', () => {
  it('opens a pending ticket and records an "opened" event', async () => {
    const { ticket, created } = await openTicketIfNeeded(CONVERSATION, {
      source: 'inbound',
      initiatedBy: 'customer',
    })

    expect(created).toBe(true)
    expect(ticket.status).toBe('pending')
    expect(ticket.account_id).toBe(ACCOUNT)
    expect(ticket.protocol_number).toBe(1)
    expect(h.state.ticketEvents).toEqual([
      expect.objectContaining({ ticket_id: ticket.id, type: 'opened' }),
    ])
  })

  it('is idempotent: a second call while one is open returns the same ticket, no new row', async () => {
    const first = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    const second = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    expect(second.created).toBe(false)
    expect(second.ticket.id).toBe(first.ticket.id)
    expect(h.state.tickets).toHaveLength(1)
  })

  it('does not call next_ticket_protocol when a ticket is already open for the conversation', async () => {
    await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    expect(h.state.protocolCounters[ACCOUNT]).toBe(1)

    // Every one of these must short-circuit on the existing-open-ticket
    // check and never touch account_ticket_counters — this is the bug
    // that burned protocol numbers on every message to an already-open
    // ticket (verified live: 1279 -> 1291 with zero new tickets).
    for (let i = 0; i < 5; i++) {
      await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    }

    expect(h.state.protocolCounters[ACCOUNT]).toBe(1)
    expect(h.state.tickets).toHaveLength(1)
  })

  it('two concurrent calls for the same conversation never create two open tickets', async () => {
    const [a, b] = await Promise.all([
      openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' }),
      openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' }),
    ])

    expect(h.state.tickets).toHaveLength(1)
    expect(a.ticket.id).toBe(b.ticket.id)
    // Exactly one of the two calls actually inserted the row.
    expect([a.created, b.created].sort()).toEqual([false, true])
  })

  it('a closed ticket does not block opening a brand new one for the same conversation', async () => {
    const { ticket: opened } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await closeTicket(opened.id, CLOSING_REASON, AGENT)

    const { ticket: reopened, created } = await openTicketIfNeeded(CONVERSATION, {
      source: 'inbound',
      initiatedBy: 'customer',
    })

    expect(created).toBe(true)
    expect(reopened.id).not.toBe(opened.id)
    expect(h.state.tickets).toHaveLength(2)
  })
})

describe('resolveInboundTicketAttribution', () => {
  it('attributes to the campaign when a broadcast was sent within the window', async () => {
    h.state.broadcastRecipients.push({
      contact_id: CONTACT,
      broadcast_id: 'broadcast-1',
      sent_at: isoHoursAgo(1),
    })

    const attribution = await resolveInboundTicketAttribution(CONVERSATION)

    expect(attribution).toEqual({ source: 'campaign', campaignId: 'broadcast-1' })
  })

  it('falls back to inbound when the broadcast send is older than the attribution window', async () => {
    h.state.broadcastRecipients.push({
      contact_id: CONTACT,
      broadcast_id: 'broadcast-1',
      sent_at: isoHoursAgo(CAMPAIGN_ATTRIBUTION_WINDOW_HOURS + 1),
    })

    const attribution = await resolveInboundTicketAttribution(CONVERSATION)

    expect(attribution).toEqual({ source: 'inbound', campaignId: null })
  })

  it('falls back to inbound when there is no broadcast history at all', async () => {
    const attribution = await resolveInboundTicketAttribution(CONVERSATION)
    expect(attribution).toEqual({ source: 'inbound', campaignId: null })
  })

  it('a broadcast send by itself never creates a ticket — only the reply does, attributed to it', async () => {
    // The send happens: broadcast_recipients gets a row. Nothing in this
    // module is called for the send itself (no openTicketIfNeeded call
    // here) — that's the rule under test.
    h.state.broadcastRecipients.push({
      contact_id: CONTACT,
      broadcast_id: 'broadcast-1',
      sent_at: isoHoursAgo(2),
    })
    expect(h.state.tickets).toHaveLength(0)

    // The customer replies — this is the only thing allowed to open a ticket.
    const attribution = await resolveInboundTicketAttribution(CONVERSATION)
    const { ticket } = await openTicketIfNeeded(CONVERSATION, {
      source: attribution.source,
      initiatedBy: 'customer',
      campaignId: attribution.campaignId,
    })

    expect(h.state.tickets).toHaveLength(1)
    expect(ticket.source).toBe('campaign')
    expect(ticket.campaign_id).toBe('broadcast-1')
  })
})

describe('recordAgentReply — first_response_at', () => {
  it('a bot message never sets first_response_at', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    await recordAgentReply(CONVERSATION, {
      senderType: 'bot',
      createdAt: new Date(Date.now() + 1000).toISOString(),
    })

    const reloaded = h.state.tickets.find((t) => t.id === ticket.id)
    expect(reloaded.first_response_at).toBeNull()
  })

  it('a customer message never sets first_response_at', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    await recordAgentReply(CONVERSATION, {
      senderType: 'customer',
      createdAt: new Date(Date.now() + 1000).toISOString(),
    })

    const reloaded = h.state.tickets.find((t) => t.id === ticket.id)
    expect(reloaded.first_response_at).toBeNull()
  })

  it('a real human agent reply after opened_at sets first_response_at, once', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    const firstReplyAt = new Date(Date.now() + 1000).toISOString()

    await recordAgentReply(CONVERSATION, { senderType: 'agent', createdAt: firstReplyAt })
    let reloaded = h.state.tickets.find((t) => t.id === ticket.id)
    expect(reloaded.first_response_at).toBe(firstReplyAt)

    // A second agent message must not overwrite it.
    await recordAgentReply(CONVERSATION, {
      senderType: 'agent',
      createdAt: new Date(Date.now() + 2000).toISOString(),
    })
    reloaded = h.state.tickets.find((t) => t.id === ticket.id)
    expect(reloaded.first_response_at).toBe(firstReplyAt)
  })

  it('does not count the message that opened the ticket when initiatedBy is company', async () => {
    const openedAt = new Date().toISOString()
    const { ticket } = await openTicketIfNeeded(CONVERSATION, {
      source: 'manual_outbound',
      initiatedBy: 'company',
      actorId: AGENT,
      occurredAt: openedAt,
    })

    // Etapa 4 would call recordAgentReply for every outbound agent
    // message, including (by mistake or not) the one that just opened
    // the ticket — this must still be excluded on its own.
    await recordAgentReply(CONVERSATION, { senderType: 'agent', createdAt: openedAt })

    const reloaded = h.state.tickets.find((t) => t.id === ticket.id)
    expect(reloaded.first_response_at).toBeNull()
  })

  it('does not count a broadcast mirror message even though sender_type is agent', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    h.state.broadcastRecipients.push({
      contact_id: CONTACT,
      whatsapp_message_id: 'wamid-broadcast-1',
      sent_at: isoHoursAgo(1),
    })

    await recordAgentReply(CONVERSATION, {
      senderType: 'agent',
      createdAt: new Date(Date.now() + 1000).toISOString(),
      messageId: 'wamid-broadcast-1',
    })

    const reloaded = h.state.tickets.find((t) => t.id === ticket.id)
    expect(reloaded.first_response_at).toBeNull()
  })

  it('no-ops quietly when there is no open ticket for the conversation', async () => {
    await expect(
      recordAgentReply(CONVERSATION, { senderType: 'agent', createdAt: new Date().toISOString() }),
    ).resolves.toBeUndefined()
  })
})

describe('assignTicket', () => {
  it('assigns the agent and moves status to in_progress, recording an event', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    const updated = await assignTicket(ticket.id, AGENT, AGENT)

    expect(updated.assigned_agent_id).toBe(AGENT)
    expect(updated.status).toBe('in_progress')
    expect(h.state.ticketEvents).toContainEqual(
      expect.objectContaining({ ticket_id: ticket.id, type: 'assigned', to_agent_id: AGENT }),
    )
  })

  it('rejects an actor from a different account', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    await expect(assignTicket(ticket.id, AGENT, ACTOR_OTHER_ACCOUNT)).rejects.toBeInstanceOf(
      TicketAccountMismatchError,
    )
  })

  it('rejects assigning a closed ticket', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await closeTicket(ticket.id, CLOSING_REASON, AGENT)

    await expect(assignTicket(ticket.id, AGENT, AGENT)).rejects.toBeInstanceOf(TicketClosedError)
  })
})

describe('transferTicket', () => {
  it('moves the ticket to a new department and agent, recording from/to', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await assignTicket(ticket.id, AGENT, AGENT)

    const updated = await transferTicket(ticket.id, { toAgentId: OTHER_AGENT, toDepartmentId: DEPARTMENT }, AGENT)

    expect(updated.assigned_agent_id).toBe(OTHER_AGENT)
    expect(updated.department_id).toBe(DEPARTMENT)
    expect(h.state.ticketEvents).toContainEqual(
      expect.objectContaining({
        ticket_id: ticket.id,
        type: 'transferred',
        from_agent_id: AGENT,
        to_agent_id: OTHER_AGENT,
        to_department_id: DEPARTMENT,
      }),
    )
  })

  it('requires at least one target', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await expect(transferTicket(ticket.id, {}, AGENT)).rejects.toThrow()
  })
})

describe('returnToQueue', () => {
  it('unassigns the agent and sets status back to pending', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await assignTicket(ticket.id, AGENT, AGENT)

    const updated = await returnToQueue(ticket.id, AGENT)

    expect(updated.assigned_agent_id).toBeNull()
    expect(updated.status).toBe('pending')
    expect(h.state.ticketEvents).toContainEqual(
      expect.objectContaining({ ticket_id: ticket.id, type: 'returned', to_agent_id: null }),
    )
  })
})

describe('closeTicket', () => {
  it('requires a closing reason', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    // @ts-expect-error — deliberately omitting the required argument
    await expect(closeTicket(ticket.id, undefined, AGENT)).rejects.toThrow()
  })

  it('rejects a closing reason from another account', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await expect(closeTicket(ticket.id, OTHER_ACCOUNT_REASON, AGENT)).rejects.toThrow()
  })

  it('closes with closed_by="agent" when an actor is given, recording an event', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    const updated = await closeTicket(ticket.id, CLOSING_REASON, AGENT, 'cliente resolveu por telefone')

    expect(updated.status).toBe('closed')
    expect(updated.closed_by).toBe('agent')
    expect(updated.closing_reason_id).toBe(CLOSING_REASON)
    expect(updated.closing_note).toBe('cliente resolveu por telefone')
    expect(updated.closed_at).not.toBeNull()
    expect(h.state.ticketEvents).toContainEqual(
      expect.objectContaining({ ticket_id: ticket.id, type: 'closed' }),
    )
  })

  it('closes with closed_by="system" when actorId is null, skipping the account check', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    const updated = await closeTicket(ticket.id, CLOSING_REASON, null)

    expect(updated.closed_by).toBe('system')
  })

  it('rejects closing an already-closed ticket', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await closeTicket(ticket.id, CLOSING_REASON, AGENT)

    await expect(closeTicket(ticket.id, CLOSING_REASON, AGENT)).rejects.toBeInstanceOf(TicketClosedError)
  })
})

describe('assignTicket / returnToQueue with a null (system) actor', () => {
  it('assignTicket skips the account check when actorId is null', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    const updated = await assignTicket(ticket.id, AGENT, null)

    expect(updated.assigned_agent_id).toBe(AGENT)
    expect(h.state.ticketEvents).toContainEqual(
      expect.objectContaining({ ticket_id: ticket.id, type: 'assigned', actor_id: null }),
    )
  })

  it('returnToQueue skips the account check when actorId is null', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await assignTicket(ticket.id, AGENT, AGENT)

    const updated = await returnToQueue(ticket.id, null)

    expect(updated.assigned_agent_id).toBeNull()
    expect(updated.status).toBe('pending')
  })
})

describe('findOpenTicket', () => {
  it('returns the open ticket for a conversation', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    const found = await findOpenTicket(CONVERSATION)
    expect(found?.id).toBe(ticket.id)
  })

  it('returns null when the conversation has no open ticket', async () => {
    expect(await findOpenTicket(CONVERSATION)).toBeNull()
  })

  it('returns null once the only ticket is closed', async () => {
    const { ticket } = await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    await closeTicket(ticket.id, CLOSING_REASON, AGENT)
    expect(await findOpenTicket(CONVERSATION)).toBeNull()
  })
})

describe('closeTicketWithoutReason — Etapa 4 transition placeholder', () => {
  it('closes the open ticket with the seeded "no_reason_informed" system reason', async () => {
    await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })

    const closed = await closeTicketWithoutReason(CONVERSATION, AGENT)

    expect(closed?.status).toBe('closed')
    expect(closed?.closing_reason_id).toBe(NO_REASON_SYSTEM_REASON)
    expect(closed?.closed_by).toBe('agent')
  })

  it('closes with closed_by="system" when actorId is null (automation/flow close)', async () => {
    await openTicketIfNeeded(CONVERSATION, { source: 'inbound', initiatedBy: 'customer' })
    const closed = await closeTicketWithoutReason(CONVERSATION, null)
    expect(closed?.closed_by).toBe('system')
  })

  it('no-ops (returns null) when there is no open ticket', async () => {
    expect(await closeTicketWithoutReason(CONVERSATION, AGENT)).toBeNull()
  })
})
