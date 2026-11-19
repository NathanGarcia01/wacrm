import { describe, it, expect, beforeEach, vi } from 'vitest'

// Fase 2 (Follow-up seguro) — B1. Dedicated mock (not engine.test.ts's
// shared one) so these tests can't destabilize the existing suite —
// this one needs `automations` to filter correctly by `id` (the
// resumePendingExecution lookup) AND by account_id/trigger_type (the
// runAutomationsForTrigger list query), which the shared mock doesn't
// do today.
const h = vi.hoisted(() => ({
  state: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    automations: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pendingExecutions: [] as any[],
    conversations: {} as Record<string, { last_customer_message_at: string | null; assigned_agent_id: string | null }>,
    contactIds: new Set<string>(),
    optedOut: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    followupLogs: [] as any[],
    sentTexts: 0,
    sentTemplates: 0,
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h

  type Filter = [string, string, unknown]

  function getEq(filters: Filter[], col: string): unknown {
    return filters.find((f) => f[0] === 'eq' && f[1] === col)?.[2]
  }

  function builder(table: string) {
    const filters: Filter[] = []
    let type = 'select'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any

    const resolve = () => {
      switch (table) {
        case 'contacts': {
          const id = getEq(filters, 'id')
          if (typeof id === 'string' && state.contactIds.has(id)) {
            return { data: { id, name: 'Contato Teste', phone: '+5511999990000', email: null }, error: null }
          }
          return { data: null, error: null }
        }
        case 'accounts':
          return { data: { name: 'Conta Teste' }, error: null }
        case 'automations': {
          const id = getEq(filters, 'id')
          if (id !== undefined) {
            const row = state.automations.find((a) => a.id === id)
            return { data: row ?? null, error: row ? null : { message: 'not found' } }
          }
          const accountId = getEq(filters, 'account_id')
          const triggerType = getEq(filters, 'trigger_type')
          return {
            data: state.automations.filter((a) => a.account_id === accountId && a.trigger_type === triggerType),
            error: null,
          }
        }
        case 'automation_steps': {
          const automationId = getEq(filters, 'automation_id')
          const minPosition = filters.find((f) => f[0] === 'gte' && f[1] === 'position')?.[2] as
            | number
            | undefined
          const parentStepId = getEq(filters, 'parent_step_id')
          return {
            data: state.steps
              .filter((s) => s.automation_id === automationId)
              .filter((s) => minPosition === undefined || s.position >= minPosition)
              .filter((s) => parentStepId === undefined || s.parent_step_id === parentStepId)
              .sort((a, b) => a.position - b.position),
            error: null,
          }
        }
        case 'automation_logs': {
          if (type === 'insert') return { data: { id: 'log1' }, error: null }
          if (type === 'update') return { data: null, error: null }
          return { data: { steps_executed: [], status: 'success' }, error: null }
        }
        case 'automation_pending_executions': {
          if (type === 'insert') {
            state.pendingExecutions.push(payload)
            return { data: null, error: null }
          }
          return { data: null, error: null }
        }
        case 'conversations': {
          const id = getEq(filters, 'id')
          if (typeof id === 'string') return { data: state.conversations[id] ?? null, error: null }
          return { data: null, error: null }
        }
        case 'followup_dispatch_log': {
          if (type === 'insert') {
            state.followupLogs.push(payload)
            return { data: null, error: null }
          }
          return { data: null, error: null }
        }
        default:
          return { data: null, error: null }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {
      select: () => b,
      insert: (p: unknown) => ((type = 'insert'), (payload = p), b),
      update: (p: unknown) => ((type = 'update'), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push(['eq', k, v]), b),
      gte: (k: string, v: unknown) => (filters.push(['gte', k, v]), b),
      is: (k: string, v: unknown) => (filters.push(['eq', k, v]), b), // treat .is(col,null) as eq for parent_step_id checks
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR),
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
  engineSendTemplate: vi.fn(async () => {
    h.state.sentTemplates++
    return { whatsapp_message_id: 'm1' }
  }),
}))

import { runAutomationsForTrigger, resumePendingExecution } from './engine'

const ACCOUNT = 'acct-1'
const CONTACT = 'contact-1'
const CONVERSATION = 'conv-1'
const AUTOMATION = 'auto-1'

function ago(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  h.state.automations = []
  h.state.steps = []
  h.state.pendingExecutions = []
  h.state.conversations = {
    [CONVERSATION]: { last_customer_message_at: ago(1), assigned_agent_id: null }, // window open by default
  }
  h.state.contactIds = new Set([CONTACT])
  h.state.optedOut = false
  h.state.followupLogs = []
  h.state.sentTexts = 0
  h.state.sentTemplates = 0
})

function dispatchInput() {
  return {
    accountId: ACCOUNT,
    triggerType: 'inactivity' as const,
    contactId: CONTACT,
    context: { conversation_id: CONVERSATION, vars: { inactive_hours: 25, last_message_at: ago(25) } },
  }
}

describe('inactivity send_message — fresh recheck at send time', () => {
  it('sends normally when not opted out and the session window is open', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(1)
    expect(h.state.followupLogs.filter((l) => l.outcome === 'skipped')).toHaveLength(0)
    // 1 tentativa registrada no disparo, independente do passo de envio.
    expect(h.state.followupLogs.filter((l) => l.outcome === 'sent')).toHaveLength(1)
  })

  it('skips send_message and logs opted_out when the contact is opted out (synchronous dispatch)', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.optedOut = true

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(
      expect.objectContaining({ outcome: 'skipped', reason: 'opted_out', automation_id: AUTOMATION }),
    )
  })

  it('skips send_message and logs outside_session_window when the window has closed', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(25), assigned_agent_id: null }

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(
      expect.objectContaining({ outcome: 'skipped', reason: 'outside_session_window' }),
    )
  })

  it('does NOT apply the window/opt-out recheck to non-inactivity automations', async () => {
    // 'tag_added' falls through triggerMatches' default `return true` —
    // no special per-type config to satisfy, unlike keyword_match/
    // deal_stage_changed/button_clicked/nps_received/inactivity.
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'tag_added' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.optedOut = true // would block an inactivity automation, but this one isn't inactivity-triggered
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(25), assigned_agent_id: null }

    await runAutomationsForTrigger({ ...dispatchInput(), triggerType: 'tag_added' })

    expect(h.state.sentTexts).toBe(1)
    expect(h.state.followupLogs).toHaveLength(0)
  })
})

describe('backlog guard — never fire for a quiet period that predates activation', () => {
  // Fase 2 (Follow-up seguro) — reforço 4: as 339 conversas abertas
  // hoje (já paradas ANTES de qualquer follow-up ser ligado) não
  // podem disparar nada quando a conta ligar o recurso. Isso já era
  // garantido por engine.ts's triggerMatches (migration 119,
  // automation.activated_at), não é código novo do B1 — este teste
  // só prova que a garantia se sustenta com os campos de contexto que
  // o cron de inatividade de fato passa (inactive_hours,
  // last_message_at), generalizando pra qualquer uma das 339.
  it('does not fire when the conversation went quiet before the automation was activated', async () => {
    h.state.automations = [
      {
        id: AUTOMATION,
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'inactivity',
        trigger_config: { hours: 24 },
        // Ligado 1h atrás — mas a conversa já estava parada há 25h
        // (antes da ativação). Simula exatamente as 339 conversas
        // abertas hoje: last_message_at no passado, activated_at no
        // futuro em relação a elas.
        activated_at: ago(1),
      },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    // Nem a "tentativa" é registrada — triggerMatches nunca deixou
    // passar, então o loop em runAutomationsForTrigger nem chega a
    // chamar logFollowupDispatch/executeAutomation pra esta automation.
    expect(h.state.followupLogs).toHaveLength(0)
  })

  it('fires normally when the quiet period started AFTER activation', async () => {
    h.state.automations = [
      {
        id: AUTOMATION,
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'inactivity',
        trigger_config: { hours: 24 },
        activated_at: ago(48), // ligado bem antes da conversa ficar quieta
      },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(1)
  })
})

describe('inactivity send_template — opted-out recheck, window ignored', () => {
  it('sends normally when not opted out', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [
      { id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_template', step_config: { template_name: 'tpl1' } },
    ]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTemplates).toBe(1)
  })

  it('skips when opted out, even though the window being closed would not matter for templates', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [
      { id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_template', step_config: { template_name: 'tpl1' } },
    ]
    h.state.optedOut = true
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(999), assigned_agent_id: null }

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTemplates).toBe(0)
    expect(h.state.followupLogs).toContainEqual(expect.objectContaining({ outcome: 'skipped', reason: 'opted_out' }))
  })

  it('sends even with the window closed — send_template ignores the session window', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [
      { id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_template', step_config: { template_name: 'tpl1' } },
    ]
    h.state.conversations[CONVERSATION] = { last_customer_message_at: ago(999), assigned_agent_id: null }

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTemplates).toBe(1)
  })
})

describe('inactivity + wait step — recheck on resume, not just at trigger time', () => {
  it('parks at the wait step, then skips the resumed send_message if the contact opted out during the wait', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [
      { id: 'w1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'wait', step_config: { amount: 1, unit: 'hours' } },
      { id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 1, step_type: 'send_message', step_config: { text: 'oi' } },
    ]

    await runAutomationsForTrigger(dispatchInput())

    // Parked, nothing sent yet.
    expect(h.state.sentTexts).toBe(0)
    expect(h.state.pendingExecutions).toHaveLength(1)

    // Opt-out happens WHILE parked at the wait step — exactly the gap
    // this B1 fix closes (cron/resume routes never re-checked this
    // before dispatching the next step).
    h.state.optedOut = true

    const pending = h.state.pendingExecutions[0]
    await resumePendingExecution({
      id: 'pe1',
      automation_id: pending.automation_id,
      account_id: pending.account_id,
      user_id: pending.user_id,
      contact_id: pending.contact_id,
      log_id: pending.log_id,
      parent_step_id: pending.parent_step_id,
      branch: pending.branch,
      next_step_position: pending.next_step_position,
      context: pending.context,
    })

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(expect.objectContaining({ outcome: 'skipped', reason: 'opted_out' }))
  })

  it('resumes and sends normally when nothing changed during the wait', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [
      { id: 'w1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'wait', step_config: { amount: 1, unit: 'hours' } },
      { id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 1, step_type: 'send_message', step_config: { text: 'oi' } },
    ]

    await runAutomationsForTrigger(dispatchInput())
    const pending = h.state.pendingExecutions[0]
    await resumePendingExecution({
      id: 'pe1',
      automation_id: pending.automation_id,
      account_id: pending.account_id,
      user_id: pending.user_id,
      contact_id: pending.contact_id,
      log_id: pending.log_id,
      parent_step_id: pending.parent_step_id,
      branch: pending.branch,
      next_step_position: pending.next_step_position,
      context: pending.context,
    })

    expect(h.state.sentTexts).toBe(1)
  })
})
