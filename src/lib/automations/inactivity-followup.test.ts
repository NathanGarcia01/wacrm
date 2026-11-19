import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cancelPendingInactivityFollowups,
  isContactOptedOutForFollowup,
  logFollowupDispatch,
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
