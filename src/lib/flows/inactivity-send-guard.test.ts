import { describe, it, expect, beforeEach, vi } from 'vitest'

// Fase 2 (Follow-up seguro) — B1. Dedicated file (not
// workflow-engine.test.ts's shared mock) to isolate risk — base
// resolve()/builder() structure mirrors that file's proven mock
// closely, extended with conversations-by-id, followup_dispatch_log,
// and a parameterizable is_contact_opted_out RPC.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flows: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes: [] as any[],
    runRow: null as Record<string, unknown> | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pendingInserts: [] as any[],
    conversations: {} as Record<string, { last_customer_message_at: string | null }>,
    optedOut: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    followupLogs: [] as any[],
    runIdCounter: 0,
    sentTexts: 0,
    sentTemplates: 0,
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h

  function resolve(ops: { table: string; type: string; payload?: unknown; filters: [string, string, unknown][] }) {
    const { table, type, payload } = ops
    if (table === 'contacts') return { data: state.owned, error: null }
    if (table === 'flows') {
      const idFilter = ops.filters.find(([, k]) => k === 'id')
      if (idFilter) {
        const found = state.flows.find((f) => f.id === idFilter[2])
        return { data: found ?? null, error: null }
      }
      return { data: state.flows, error: null }
    }
    if (table === 'flow_nodes') return { data: state.nodes, error: null }
    if (table === 'flow_runs') {
      if (type === 'insert') {
        state.runIdCounter += 1
        const row = { id: `run-${state.runIdCounter}`, ...(payload as Record<string, unknown>) }
        state.runRow = row
        return { data: row, error: null }
      }
      if (type === 'update') {
        if (state.runRow) state.runRow = { ...state.runRow, ...(payload as Record<string, unknown>) }
        return { data: [{ id: state.runRow?.id }], error: null }
      }
      return { data: state.runRow, error: null }
    }
    if (table === 'flow_run_events') return { data: null, error: null }
    if (table === 'flow_pending_executions') {
      if (type === 'insert') {
        state.pendingInserts.push(payload as Record<string, unknown>)
      }
      return { data: null, error: null }
    }
    if (table === 'conversations') {
      const idFilter = ops.filters.find(([, k]) => k === 'id')
      if (idFilter) return { data: state.conversations[idFilter[2] as string] ?? null, error: null }
      return { data: null, error: null }
    }
    if (table === 'accounts') return { data: { name: 'Conta Teste' }, error: null }
    if (table === 'followup_dispatch_log') {
      if (type === 'insert') state.followupLogs.push(payload)
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(['eq', k, v]), b),
      neq: () => b,
      in: () => b,
      gte: () => b,
      lte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: (name: string) => {
        if (name === 'is_contact_opted_out') return Promise.resolve({ data: state.optedOut, error: null })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }
})

vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => {
    h.state.sentTexts++
    return { whatsapp_message_id: 'm1' }
  }),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => {
    h.state.sentTemplates++
    return { whatsapp_message_id: 'm1' }
  }),
}))

vi.mock('@/lib/nps/send-survey', () => ({
  sendNpsSurvey: vi.fn(async () => ({ sent: true })),
}))

import { runFlowsForTrigger, resumePendingWorkflowExecution } from './workflow-engine'

const ACCOUNT = 'acct-1'
const CONTACT = 'c1'
const CONVERSATION = 'conv-1'
const FLOW = 'flow-1'

function ago(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  h.state.owned = { id: CONTACT }
  h.state.flows = []
  h.state.nodes = []
  h.state.runRow = null
  h.state.pendingInserts = []
  h.state.conversations = { [CONVERSATION]: { last_customer_message_at: ago(1) } } // window open by default
  h.state.optedOut = false
  h.state.followupLogs = []
  h.state.runIdCounter = 0
  h.state.sentTexts = 0
  h.state.sentTemplates = 0
})

function workflowFlow(overrides: Record<string, unknown> = {}) {
  return {
    id: FLOW,
    account_id: ACCOUNT,
    user_id: 'u1',
    trigger_type: 'inactivity',
    run_mode: 'workflow',
    status: 'active',
    entry_node_id: 'start',
    ...overrides,
  }
}

function dispatchInput() {
  return {
    accountId: ACCOUNT,
    triggerType: 'inactivity' as const,
    contactId: CONTACT,
    context: { conversation_id: CONVERSATION, vars: { inactive_hours: 25 } },
  }
}

describe('inactivity send_message node — fresh recheck at send time', () => {
  it('sends normally when not opted out and the window is open', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'send1' } },
      { node_key: 'send1', flow_id: FLOW, node_type: 'send_message', config: { text: 'oi', next_node_key: null } },
    ]

    await runFlowsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(1)
    expect(h.state.followupLogs.filter((l) => l.outcome === 'sent')).toHaveLength(1)
    expect(h.state.followupLogs.filter((l) => l.outcome === 'skipped')).toHaveLength(0)
  })

  it('skips and logs opted_out when the contact is opted out', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'send1' } },
      { node_key: 'send1', flow_id: FLOW, node_type: 'send_message', config: { text: 'oi', next_node_key: null } },
    ]
    h.state.optedOut = true

    await runFlowsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(
      expect.objectContaining({ outcome: 'skipped', reason: 'opted_out', flow_id: FLOW }),
    )
  })

  it('skips and logs outside_session_window when the window has closed', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'send1' } },
      { node_key: 'send1', flow_id: FLOW, node_type: 'send_message', config: { text: 'oi', next_node_key: null } },
    ]
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(25) }

    await runFlowsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(expect.objectContaining({ outcome: 'skipped', reason: 'outside_session_window' }))
  })

  it('does not apply the recheck to non-inactivity flows', async () => {
    h.state.flows = [workflowFlow({ trigger_type: 'tag_added' })]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'send1' } },
      { node_key: 'send1', flow_id: FLOW, node_type: 'send_message', config: { text: 'oi', next_node_key: null } },
    ]
    h.state.optedOut = true

    await runFlowsForTrigger({ ...dispatchInput(), triggerType: 'tag_added' })

    expect(h.state.sentTexts).toBe(1)
    expect(h.state.followupLogs).toHaveLength(0)
  })
})

describe('inactivity send_template node — opted-out recheck, window ignored', () => {
  it('skips when opted out even with the window closed', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'tpl1' } },
      { node_key: 'tpl1', flow_id: FLOW, node_type: 'send_template', config: { template_name: 't1', next_node_key: null } },
    ]
    h.state.optedOut = true
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(999) }

    await runFlowsForTrigger(dispatchInput())

    expect(h.state.sentTemplates).toBe(0)
    expect(h.state.followupLogs).toContainEqual(expect.objectContaining({ outcome: 'skipped', reason: 'opted_out' }))
  })

  it('sends even with the window closed — templates ignore the session window', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'tpl1' } },
      { node_key: 'tpl1', flow_id: FLOW, node_type: 'send_template', config: { template_name: 't1', next_node_key: null } },
    ]
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(999) }

    await runFlowsForTrigger(dispatchInput())

    expect(h.state.sentTemplates).toBe(1)
  })
})

describe('inactivity + wait node — recheck on resume', () => {
  it('parks at the wait node, then skips the resumed send_message if opted out during the wait', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'wait1' } },
      { node_key: 'wait1', flow_id: FLOW, node_type: 'wait', config: { amount: 1, unit: 'hours', next_node_key: 'send1' } },
      { node_key: 'send1', flow_id: FLOW, node_type: 'send_message', config: { text: 'oi', next_node_key: null } },
    ]

    await runFlowsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.pendingInserts).toHaveLength(1)

    h.state.optedOut = true
    const pending = h.state.pendingInserts[0]
    await resumePendingWorkflowExecution({
      id: 'pe1',
      flow_id: pending.flow_id,
      flow_run_id: pending.flow_run_id,
      resume_node_key: pending.resume_node_key,
      context: pending.context,
    })

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(expect.objectContaining({ outcome: 'skipped', reason: 'opted_out' }))
  })

  it('resumes and sends normally when nothing changed during the wait', async () => {
    h.state.flows = [workflowFlow()]
    h.state.nodes = [
      { node_key: 'start', flow_id: FLOW, node_type: 'start', config: { next_node_key: 'wait1' } },
      { node_key: 'wait1', flow_id: FLOW, node_type: 'wait', config: { amount: 1, unit: 'hours', next_node_key: 'send1' } },
      { node_key: 'send1', flow_id: FLOW, node_type: 'send_message', config: { text: 'oi', next_node_key: null } },
    ]

    await runFlowsForTrigger(dispatchInput())
    const pending = h.state.pendingInserts[0]
    await resumePendingWorkflowExecution({
      id: 'pe1',
      flow_id: pending.flow_id,
      flow_run_id: pending.flow_run_id,
      resume_node_key: pending.resume_node_key,
      context: pending.context,
    })

    expect(h.state.sentTexts).toBe(1)
  })
})
