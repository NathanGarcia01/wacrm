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
    // B2 — teto diário/horário comercial.
    timezone: 'America/Sao_Paulo' as string | null,
    maxPerDay: undefined as number | undefined,
    holiday: false,
    businessHoursWindows: [] as { start_time: string; end_time: string }[],
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
          return { data: { name: 'Conta Teste', timezone: state.timezone }, error: null }
        case 'followup_settings':
          return { data: state.maxPerDay === undefined ? null : { max_per_day: state.maxPerDay }, error: null }
        case 'holidays':
          return { data: state.holiday ? { id: 'h1' } : null, error: null }
        case 'business_hours':
          return { data: state.businessHoursWindows, error: null }
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
            state.followupLogs.push({ created_at: new Date().toISOString(), ...payload })
            return { data: null, error: null }
          }
          if (type === 'upsert') {
            // Simulates ON CONFLICT (conversation_id, reason, silence_started_at) DO NOTHING
            // (migration 138's unique index) — real DB-level dedup, not a read-then-write.
            const row = payload as Record<string, unknown>
            const conflict = state.followupLogs.some(
              (r) =>
                r.conversation_id === row.conversation_id &&
                r.reason === row.reason &&
                r.silence_started_at === row.silence_started_at,
            )
            if (!conflict) state.followupLogs.push({ created_at: new Date().toISOString(), ...row })
            return { data: null, error: null }
          }
          // Count query (countFollowupAttemptsSinceLastReply /
          // countFollowupSentToday) — only ever filters with eq/gt/gte.
          const matched = state.followupLogs.filter((row) =>
            filters.every(([op, k, v]) => {
              const rowValue = row[k]
              if (op === 'eq') return rowValue === v
              if (op === 'gt') return typeof rowValue === 'string' && rowValue > (v as string)
              if (op === 'gte') return typeof rowValue === 'string' && rowValue >= (v as string)
              return true
            }),
          )
          return { count: matched.length, data: null, error: null }
        }
        default:
          return { data: null, error: null }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {
      select: () => b,
      insert: (p: unknown) => ((type = 'insert'), (payload = p), b),
      upsert: (p: unknown) => ((type = 'upsert'), (payload = p), b),
      update: (p: unknown) => ((type = 'update'), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push(['eq', k, v]), b),
      gt: (k: string, v: unknown) => (filters.push(['gt', k, v]), b),
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
  h.state.timezone = 'America/Sao_Paulo'
  h.state.maxPerDay = undefined
  h.state.holiday = false
  h.state.businessHoursWindows = []
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

describe('B2 — last_sender', () => {
  it('fires when last_sender="agent" and the last message was from an agent or a bot', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { last_sender: 'agent' } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_message_sender_type: 'bot' } },
    })

    expect(h.state.sentTexts).toBe(1)
  })

  it('does not fire (and does not log) when last_sender="agent" but the customer sent the last message', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { last_sender: 'agent' } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_message_sender_type: 'customer' } },
    })

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toHaveLength(0)
  })

  it('fires when last_sender="customer" and the customer sent the last message', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { last_sender: 'customer' } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_message_sender_type: 'customer' } },
    })

    expect(h.state.sentTexts).toBe(1)
  })

  it('fires regardless of sender when last_sender is "any" (default, old behavior)', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_message_sender_type: 'customer' } },
    })

    expect(h.state.sentTexts).toBe(1)
  })
})

describe('B2 — max_attempts (conta desde a última resposta do cliente, reinicia quando ele responde)', () => {
  it('blocks and logs max_attempts_reached once the cap is hit, counting only sent+live attempts after last_customer_message_at', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { max_attempts: 3 } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    const lastCustomerMessageAt = ago(48)
    // 3 tentativas já registradas DEPOIS da última resposta do cliente.
    h.state.followupLogs = [1, 2, 3].map((n) => ({
      account_id: ACCOUNT,
      automation_id: AUTOMATION,
      conversation_id: CONVERSATION,
      contact_id: CONTACT,
      outcome: 'sent',
      mode: 'live',
      created_at: ago(48 - n),
    }))

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_customer_message_at: lastCustomerMessageAt } },
    })

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(
      expect.objectContaining({ outcome: 'skipped', reason: 'max_attempts_reached' }),
    )
  })

  it('teste de reinício: 3 tentativas, cliente responde, esfria de novo, volta a poder receber', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { max_attempts: 3 } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    // As 3 tentativas antigas, todas ANTES da nova resposta do cliente.
    h.state.followupLogs = [1, 2, 3].map((n) => ({
      account_id: ACCOUNT,
      automation_id: AUTOMATION,
      conversation_id: CONVERSATION,
      contact_id: CONTACT,
      outcome: 'sent',
      mode: 'live',
      created_at: ago(96 - n),
    }))
    // Cliente respondeu de novo, bem depois das 3 tentativas antigas —
    // o contador reinicia a partir daqui.
    const newLastCustomerMessageAt = ago(1)

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_customer_message_at: newLastCustomerMessageAt } },
    })

    expect(h.state.sentTexts).toBe(1)
  })

  it('does not block when max_attempts is unset (unlimited, default)', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.followupLogs = [1, 2, 3, 4, 5].map((n) => ({
      account_id: ACCOUNT,
      automation_id: AUTOMATION,
      conversation_id: CONVERSATION,
      contact_id: CONTACT,
      outcome: 'sent',
      mode: 'live',
      created_at: ago(48 - n),
    }))

    await runAutomationsForTrigger({
      ...dispatchInput(),
      context: { ...dispatchInput().context, vars: { ...dispatchInput().context.vars, last_customer_message_at: ago(48) } },
    })

    expect(h.state.sentTexts).toBe(1)
  })
})

describe('B2 — teto diário (followup_settings.max_per_day, default 50; dry_run nunca conta)', () => {
  it("blocks and logs daily_cap_reached once today's sent+live count reaches max_per_day", async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.maxPerDay = 2
    h.state.followupLogs = [
      { account_id: ACCOUNT, outcome: 'sent', mode: 'live', created_at: new Date().toISOString() },
      { account_id: ACCOUNT, outcome: 'sent', mode: 'live', created_at: new Date().toISOString() },
      // dry-run não conta pro teto — mesmo com uma linha dry_run, o
      // teto de 2 ainda não teria sido alcançado só por ela.
      { account_id: ACCOUNT, outcome: 'sent', mode: 'dry_run', created_at: new Date().toISOString() },
    ]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(
      expect.objectContaining({ outcome: 'skipped', reason: 'daily_cap_reached' }),
    )
  })

  it('fires normally when below the cap', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.maxPerDay = 2
    h.state.followupLogs = [{ account_id: ACCOUNT, outcome: 'sent', mode: 'live', created_at: new Date().toISOString() }]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(1)
  })
})

describe('B2 — horário comercial (respect_business_hours)', () => {
  it('defers and logs outside_business_hours when respect_business_hours=true and nothing is configured', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { respect_business_hours: true } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.businessHoursWindows = [] // nenhuma janela cadastrada = fora do horário

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(0)
    expect(h.state.followupLogs).toContainEqual(
      expect.objectContaining({ outcome: 'skipped', reason: 'outside_business_hours' }),
    )
  })

  it('fires when respect_business_hours=true and now falls inside a configured window', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { respect_business_hours: true } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    // Janela cobrindo o dia inteiro — sempre "dentro", sem depender do
    // horário real em que o teste roda.
    h.state.businessHoursWindows = [{ start_time: '00:00:00', end_time: '23:59:59' }]

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(1)
  })

  it('ignores business hours entirely when respect_business_hours is unset (default false)', async () => {
    h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity' }]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.businessHoursWindows = [] // fora do horário, mas o check nem roda

    await runAutomationsForTrigger(dispatchInput())

    expect(h.state.sentTexts).toBe(1)
  })
})

describe('B2 fix — dedup de skip por período de silêncio (max_attempts_reached/daily_cap_reached/outside_business_hours)', () => {
  it('100 varreduras seguidas na mesma conversa fora do horário geram 1 linha, não 100', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { respect_business_hours: true } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.businessHoursWindows = [] // nenhuma janela cadastrada = sempre fora do horário
    // Mesmo objeto de input reaproveitado 100x — exatamente como o cron
    // chamaria 100 vezes seguidas sem NINGUÉM mandar mensagem nova: o
    // last_message_at da conversa (a âncora do período de silêncio)
    // não muda entre varreduras.
    const input = dispatchInput()

    for (let i = 0; i < 100; i++) {
      await runAutomationsForTrigger(input)
    }

    expect(h.state.sentTexts).toBe(0)
    const skipRows = h.state.followupLogs.filter((l) => l.reason === 'outside_business_hours')
    expect(skipRows).toHaveLength(1)
  })

  it('uma nova mensagem (last_message_at avança) inicia um novo período e permite logar o skip de novo', async () => {
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'inactivity', trigger_config: { respect_business_hours: true } },
    ]
    h.state.steps = [{ id: 's1', automation_id: AUTOMATION, parent_step_id: null, position: 0, step_type: 'send_message', step_config: { text: 'oi' } }]
    h.state.businessHoursWindows = []
    const firstPeriod = dispatchInput()

    for (let i = 0; i < 5; i++) {
      await runAutomationsForTrigger(firstPeriod)
    }
    expect(h.state.followupLogs.filter((l) => l.reason === 'outside_business_hours')).toHaveLength(1)

    // Uma mensagem nova chega — o cron do próximo tick passaria um
    // last_message_at mais recente, uma âncora de período diferente.
    const secondPeriod = {
      ...firstPeriod,
      context: { ...firstPeriod.context, vars: { ...firstPeriod.context.vars, last_message_at: ago(1) } },
    }

    for (let i = 0; i < 5; i++) {
      await runAutomationsForTrigger(secondPeriod)
    }

    // 1 linha do período antigo + 1 linha do período novo — nunca 10.
    expect(h.state.followupLogs.filter((l) => l.reason === 'outside_business_hours')).toHaveLength(2)
  })
})
