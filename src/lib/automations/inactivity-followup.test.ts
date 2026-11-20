import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cancelPendingInactivityFollowups,
  countFollowupAttemptsSinceLastReply,
  countFollowupSentToday,
  isContactOptedOutForFollowup,
  logFollowupDispatch,
  logFollowupSkipOncePerSilencePeriod,
} from './inactivity-followup'

interface FakeState {
  optedOut: boolean
  optedOutError: boolean
  automations: { id: string; account_id: string; trigger_type: string }[]
  flows: { id: string; account_id: string; trigger_type: string }[]
  automationPending: { id: string; automation_id: string; contact_id: string; status: string }[]
  flowPending: { id: string; flow_id: string; contact_id: string; status: string }[]
  conversations: { id: string; account_id: string; contact_id: string }[]
  dispatchLogInserts: Record<string, unknown>[]
}

function newState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    optedOut: false,
    optedOutError: false,
    automations: [],
    flows: [],
    automationPending: [],
    flowPending: [],
    conversations: [],
    dispatchLogInserts: [],
    ...overrides,
  }
}

function fakeDb(state: FakeState): SupabaseClient {
  function builder(table: string) {
    const filters: [string, unknown][] = []
    let updatePayload: Record<string, unknown> | undefined
    let insertPayload: Record<string, unknown> | undefined

    function matchesFilters<T extends Record<string, unknown>>(row: T): boolean {
      return filters.every(([k, v]) => {
        if (k === 'in') return true // handled separately below
        return (row as Record<string, unknown>)[k] === v
      })
    }

    const resolve = () => {
      if (table === 'followup_dispatch_log' && insertPayload) {
        state.dispatchLogInserts.push(insertPayload)
        return { data: null, error: null }
      }
      if (table === 'automations') {
        const accountId = filters.find((f) => f[0] === 'account_id')?.[1]
        const triggerType = filters.find((f) => f[0] === 'trigger_type')?.[1]
        return {
          data: state.automations.filter((a) => a.account_id === accountId && a.trigger_type === triggerType),
          error: null,
        }
      }
      if (table === 'flows') {
        const accountId = filters.find((f) => f[0] === 'account_id')?.[1]
        const triggerType = filters.find((f) => f[0] === 'trigger_type')?.[1]
        return {
          data: state.flows.filter((f) => f.account_id === accountId && f.trigger_type === triggerType),
          error: null,
        }
      }
      if (table === 'automation_pending_executions') {
        const contactId = filters.find((f) => f[0] === 'contact_id')?.[1]
        const status = filters.find((f) => f[0] === 'status')?.[1]
        const inIds = filters.find((f) => f[0] === 'in')?.[1] as string[] | undefined
        const matched = state.automationPending.filter(
          (r) => r.contact_id === contactId && r.status === status && (!inIds || inIds.includes(r.automation_id)),
        )
        if (updatePayload) {
          matched.forEach((r) => Object.assign(r, updatePayload))
        }
        return { data: matched.map((r) => ({ id: r.id })), error: null }
      }
      if (table === 'flow_pending_executions') {
        const contactId = filters.find((f) => f[0] === 'contact_id')?.[1]
        const status = filters.find((f) => f[0] === 'status')?.[1]
        const inIds = filters.find((f) => f[0] === 'in')?.[1] as string[] | undefined
        const matched = state.flowPending.filter(
          (r) => r.contact_id === contactId && r.status === status && (!inIds || inIds.includes(r.flow_id)),
        )
        if (updatePayload) {
          matched.forEach((r) => Object.assign(r, updatePayload))
        }
        return { data: matched.map((r) => ({ id: r.id })), error: null }
      }
      if (table === 'conversations') {
        const accountId = filters.find((f) => f[0] === 'account_id')?.[1]
        const contactId = filters.find((f) => f[0] === 'contact_id')?.[1]
        const row = state.conversations.find((c) => c.account_id === accountId && c.contact_id === contactId)
        return { data: row ?? null, error: null }
      }
      return { data: null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      insert: (p: Record<string, unknown>) => {
        insertPayload = p
        return b
      },
      update: (p: Record<string, unknown>) => {
        updatePayload = p
        return b
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      in: (_k: string, v: unknown) => {
        filters.push(['in', v])
        return b
      },
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    void matchesFilters
    return b
  }

  return {
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      if (name === 'is_contact_opted_out') {
        if (state.optedOutError) return Promise.resolve({ data: null, error: { message: 'boom' } })
        return Promise.resolve({ data: state.optedOut, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('isContactOptedOutForFollowup', () => {
  it('returns the RPC result when it succeeds', async () => {
    expect(await isContactOptedOutForFollowup(fakeDb(newState({ optedOut: true })), 'acc1', 'c1')).toBe(true)
    expect(await isContactOptedOutForFollowup(fakeDb(newState({ optedOut: false })), 'acc1', 'c1')).toBe(false)
  })

  it('fails closed (treats as opted-out) when the RPC errors', async () => {
    expect(await isContactOptedOutForFollowup(fakeDb(newState({ optedOutError: true })), 'acc1', 'c1')).toBe(true)
  })
})

describe('logFollowupDispatch', () => {
  it('inserts exactly one row with the given fields', async () => {
    const state = newState()
    const db = fakeDb(state)
    await logFollowupDispatch(db, {
      accountId: 'acc1',
      automationId: 'auto1',
      conversationId: 'conv1',
      contactId: 'c1',
      outcome: 'sent',
    })
    expect(state.dispatchLogInserts).toHaveLength(1)
    expect(state.dispatchLogInserts[0]).toMatchObject({
      account_id: 'acc1',
      automation_id: 'auto1',
      flow_id: null,
      outcome: 'sent',
      mode: 'live',
    })
  })

  it('does not throw when the insert fails (best-effort)', async () => {
    const db = {
      from: () => ({
        insert: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    await expect(
      logFollowupDispatch(db, { accountId: 'acc1', conversationId: 'conv1', contactId: 'c1', outcome: 'skipped' }),
    ).resolves.not.toThrow()
  })
})

describe('cancelPendingInactivityFollowups', () => {
  it('cancels pending wait steps/nodes only for inactivity-triggered automations/flows', async () => {
    const state = newState({
      automations: [
        { id: 'auto-inactivity', account_id: 'acc1', trigger_type: 'inactivity' },
        { id: 'auto-keyword', account_id: 'acc1', trigger_type: 'keyword_match' },
      ],
      flows: [{ id: 'flow-inactivity', account_id: 'acc1', trigger_type: 'inactivity' }],
      automationPending: [
        { id: 'p1', automation_id: 'auto-inactivity', contact_id: 'c1', status: 'pending' },
        { id: 'p2', automation_id: 'auto-keyword', contact_id: 'c1', status: 'pending' },
      ],
      flowPending: [{ id: 'fp1', flow_id: 'flow-inactivity', contact_id: 'c1', status: 'pending' }],
      conversations: [{ id: 'conv1', account_id: 'acc1', contact_id: 'c1' }],
    })
    const db = fakeDb(state)

    const result = await cancelPendingInactivityFollowups(db, { accountId: 'acc1', contactId: 'c1' }, 'customer_replied')

    expect(result).toEqual({ automationsCancelled: 1, flowsCancelled: 1 })
    expect(state.automationPending.find((p) => p.id === 'p1')?.status).toBe('cancelled')
    // Keyword-triggered automation's pending step is untouched — out of scope.
    expect(state.automationPending.find((p) => p.id === 'p2')?.status).toBe('pending')
    expect(state.flowPending.find((p) => p.id === 'fp1')?.status).toBe('cancelled')
    expect(state.dispatchLogInserts).toHaveLength(1)
    expect(state.dispatchLogInserts[0]).toMatchObject({ reason: 'customer_replied', outcome: 'skipped' })
  })

  it('is a no-op (no log row) when there is nothing pending to cancel', async () => {
    const state = newState({
      automations: [{ id: 'auto-inactivity', account_id: 'acc1', trigger_type: 'inactivity' }],
      conversations: [{ id: 'conv1', account_id: 'acc1', contact_id: 'c1' }],
    })
    const db = fakeDb(state)

    const result = await cancelPendingInactivityFollowups(db, { accountId: 'acc1', contactId: 'c1' }, 'opted_out')

    expect(result).toEqual({ automationsCancelled: 0, flowsCancelled: 0 })
    expect(state.dispatchLogInserts).toHaveLength(0)
  })
})

interface DispatchLogRow {
  conversation_id?: string
  account_id?: string
  outcome: string
  mode: string
  created_at: string
}

function fakeCountDb(rows: DispatchLogRow[]): SupabaseClient {
  function builder(table: string) {
    const filters: { op: 'eq' | 'gt' | 'gte'; key: string; value: unknown }[] = []
    const resolve = () => {
      if (table !== 'followup_dispatch_log') return { count: 0, error: null }
      const matched = rows.filter((row) =>
        filters.every(({ op, key, value }) => {
          const rowValue = (row as unknown as Record<string, unknown>)[key]
          if (op === 'eq') return rowValue === value
          if (op === 'gt') return typeof rowValue === 'string' && rowValue > (value as string)
          return typeof rowValue === 'string' && rowValue >= (value as string)
        }),
      )
      return { count: matched.length, error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: (key: string, value: unknown) => (filters.push({ op: 'eq', key, value }), b),
      gt: (key: string, value: unknown) => (filters.push({ op: 'gt', key, value }), b),
      gte: (key: string, value: unknown) => (filters.push({ op: 'gte', key, value }), b),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient
}

describe('countFollowupAttemptsSinceLastReply', () => {
  it('counts only sent+live attempts after the last reply, and restarts after a new reply (teste de reinício)', async () => {
    const rows: DispatchLogRow[] = [
      { conversation_id: 'conv1', outcome: 'sent', mode: 'live', created_at: '2026-11-10T10:00:00.000Z' },
      { conversation_id: 'conv1', outcome: 'sent', mode: 'live', created_at: '2026-11-11T10:00:00.000Z' },
      { conversation_id: 'conv1', outcome: 'sent', mode: 'live', created_at: '2026-11-12T10:00:00.000Z' },
      // dry-run nunca conta pra max_attempts.
      { conversation_id: 'conv1', outcome: 'sent', mode: 'dry_run', created_at: '2026-11-12T11:00:00.000Z' },
      // skip (não-enviado) também não conta.
      { conversation_id: 'conv1', outcome: 'skipped', mode: 'live', created_at: '2026-11-12T12:00:00.000Z' },
    ]
    const db = fakeCountDb(rows)

    const oldLastCustomerMessageAt = '2026-11-09T00:00:00.000Z'
    expect(await countFollowupAttemptsSinceLastReply(db, 'conv1', oldLastCustomerMessageAt)).toBe(3)

    // Cliente responde de novo (last_customer_message_at avança) — as 3
    // tentativas antigas ficam no passado da nova resposta e deixam de
    // contar: o contador reinicia, permitindo novos follow-ups.
    const newLastCustomerMessageAt = '2026-11-13T00:00:00.000Z'
    expect(await countFollowupAttemptsSinceLastReply(db, 'conv1', newLastCustomerMessageAt)).toBe(0)
  })

  it('counts every historical sent+live attempt when the conversation never heard back from the customer', async () => {
    const rows: DispatchLogRow[] = [
      { conversation_id: 'conv1', outcome: 'sent', mode: 'live', created_at: '2020-01-01T00:00:00.000Z' },
      { conversation_id: 'conv1', outcome: 'sent', mode: 'live', created_at: '2020-01-02T00:00:00.000Z' },
      { conversation_id: 'conv2', outcome: 'sent', mode: 'live', created_at: '2020-01-02T00:00:00.000Z' },
    ]
    const db = fakeCountDb(rows)
    expect(await countFollowupAttemptsSinceLastReply(db, 'conv1', null)).toBe(2)
  })
})

describe('countFollowupSentToday', () => {
  it('counts only sent+live dispatches from today in the account timezone, for that account', async () => {
    const rows: DispatchLogRow[] = [
      // 2026-11-18T02:00Z = 2026-11-17T23:00 em America/Sao_Paulo (dia anterior, não conta).
      { account_id: 'acc1', outcome: 'sent', mode: 'live', created_at: '2026-11-18T02:00:00.000Z' },
      // Hoje (dia local 2026-11-18), conta.
      { account_id: 'acc1', outcome: 'sent', mode: 'live', created_at: '2026-11-18T12:00:00.000Z' },
      // dry-run não conta pro teto diário.
      { account_id: 'acc1', outcome: 'sent', mode: 'dry_run', created_at: '2026-11-18T12:30:00.000Z' },
      // skip não conta.
      { account_id: 'acc1', outcome: 'skipped', mode: 'live', created_at: '2026-11-18T13:00:00.000Z' },
      // outra conta não conta.
      { account_id: 'acc2', outcome: 'sent', mode: 'live', created_at: '2026-11-18T12:00:00.000Z' },
    ]
    const db = fakeCountDb(rows)
    const now = new Date('2026-11-18T15:00:00.000Z')
    expect(await countFollowupSentToday(db, 'acc1', 'America/Sao_Paulo', now)).toBe(1)
  })
})

interface UpsertedRow {
  conversation_id: string
  reason: string
  silence_started_at: string | null
  [key: string]: unknown
}

function fakeUpsertDb(rows: UpsertedRow[]): SupabaseClient {
  function builder(table: string) {
    let payload: Record<string, unknown> | undefined
    const resolve = () => {
      if (table !== 'followup_dispatch_log' || !payload) return { data: null, error: null }
      const row = payload as unknown as UpsertedRow
      // Simula a constraint única real (conversation_id, reason,
      // silence_started_at) — migration 138 — com ON CONFLICT DO
      // NOTHING (ignoreDuplicates): a 2ª+ chamada com a MESMA chave
      // nunca grava uma linha nova.
      const conflict = rows.some(
        (r) =>
          r.conversation_id === row.conversation_id &&
          r.reason === row.reason &&
          r.silence_started_at === row.silence_started_at,
      )
      if (!conflict) rows.push(row)
      return { data: null, error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      upsert: (p: Record<string, unknown>) => {
        payload = p
        return b
      },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient
}

describe('logFollowupSkipOncePerSilencePeriod', () => {
  it('100 varreduras seguidas na mesma conversa (mesmo motivo, mesmo período) geram 1 linha, não 100', async () => {
    const rows: UpsertedRow[] = []
    const db = fakeUpsertDb(rows)
    const silenceStartedAt = '2026-11-18T10:00:00.000Z'

    for (let i = 0; i < 100; i++) {
      await logFollowupSkipOncePerSilencePeriod(
        db,
        { accountId: 'acc1', conversationId: 'conv1', contactId: 'c1', reason: 'opted_out' },
        silenceStartedAt,
      )
    }

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ conversation_id: 'conv1', reason: 'opted_out', silence_started_at: silenceStartedAt })
  })

  it('uma nova mensagem (silenceStartedAt avança) inicia um novo período e permite logar de novo', async () => {
    const rows: UpsertedRow[] = []
    const db = fakeUpsertDb(rows)

    for (let i = 0; i < 5; i++) {
      await logFollowupSkipOncePerSilencePeriod(
        db,
        { accountId: 'acc1', conversationId: 'conv1', contactId: 'c1', reason: 'opted_out' },
        '2026-11-18T10:00:00.000Z',
      )
    }
    for (let i = 0; i < 5; i++) {
      await logFollowupSkipOncePerSilencePeriod(
        db,
        { accountId: 'acc1', conversationId: 'conv1', contactId: 'c1', reason: 'opted_out' },
        '2026-11-19T10:00:00.000Z',
      )
    }

    expect(rows).toHaveLength(2)
  })

  it('motivos diferentes na mesma conversa/período não colidem entre si', async () => {
    const rows: UpsertedRow[] = []
    const db = fakeUpsertDb(rows)
    const silenceStartedAt = '2026-11-18T10:00:00.000Z'

    await logFollowupSkipOncePerSilencePeriod(
      db,
      { accountId: 'acc1', conversationId: 'conv1', contactId: 'c1', reason: 'opted_out' },
      silenceStartedAt,
    )
    await logFollowupSkipOncePerSilencePeriod(
      db,
      { accountId: 'acc1', conversationId: 'conv1', contactId: 'c1', reason: 'daily_cap_reached' },
      silenceStartedAt,
    )

    expect(rows).toHaveLength(2)
  })
})
