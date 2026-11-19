import { describe, expect, it, vi, beforeEach } from 'vitest'

// Fase 2 (Follow-up seguro) — B1. Mocks each imported lib function
// directly (same convention as tickets/[id]/close/route.test.ts)
// rather than faking the whole DB — runAutomationsForTrigger/
// runFlowsForTrigger/getAccountPlanFeatures/isContactOptedOutForFollowup/
// logFollowupDispatch are all spies; only the route's OWN raw queries
// (lock, automations/flows list, cursor, conversations) go through a
// minimal fake supabaseAdmin().

const h = vi.hoisted(() => ({
  state: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    automations: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flows: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversationsByAccount: {} as Record<string, any[]>,
    cursors: {} as Record<string, { last_seen_last_message_at: string | null; last_seen_conversation_id: string | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorUpserts: [] as any[],
  },
}))

vi.mock('@/lib/automations/admin-client', () => {
  const { state } = h
  function builder(table: string) {
    const filters: [string, unknown][] = []
    let type = 'select'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any
    const getEq = (k: string) => filters.find((f) => f[0] === k)?.[1]

    const resolve = () => {
      if (table === 'automations') return { data: state.automations, error: null }
      if (table === 'flows') return { data: state.flows, error: null }
      if (table === 'inactivity_scan_cursor') {
        if (type === 'upsert') {
          state.cursorUpserts.push(payload)
          state.cursors[payload.account_id] = payload
          return { data: null, error: null }
        }
        const accountId = getEq('account_id') as string
        return { data: state.cursors[accountId] ?? null, error: null }
      }
      if (table === 'conversations') {
        const accountId = getEq('account_id') as string
        return { data: state.conversationsByAccount[accountId] ?? [], error: null }
      }
      return { data: null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      upsert: (p: unknown) => ((type = 'upsert'), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      lt: () => b,
      not: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: (name: string) => {
        if (name === 'try_acquire_cron_lock') return Promise.resolve({ data: true, error: null })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }
})

const mocks = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  runFlowsForTrigger: vi.fn(),
  isContactOptedOutForFollowup: vi.fn(),
  logFollowupDispatch: vi.fn(),
  getAccountPlanFeatures: vi.fn(),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}))

vi.mock('@/lib/flows/workflow-engine', () => ({
  runFlowsForTrigger: mocks.runFlowsForTrigger,
}))

vi.mock('@/lib/automations/inactivity-followup', () => ({
  isContactOptedOutForFollowup: mocks.isContactOptedOutForFollowup,
  logFollowupDispatch: mocks.logFollowupDispatch,
}))

vi.mock('@/lib/billing/server', () => ({
  getAccountPlanFeatures: mocks.getAccountPlanFeatures,
}))

const runAutomationsForTriggerMock = mocks.runAutomationsForTrigger
const runFlowsForTriggerMock = mocks.runFlowsForTrigger
const isContactOptedOutForFollowupMock = mocks.isContactOptedOutForFollowup
const logFollowupDispatchMock = mocks.logFollowupDispatch
const getAccountPlanFeaturesMock = mocks.getAccountPlanFeatures

import { GET } from './route'

const ACCOUNT = 'acct-1'
const CONTACT = 'contact-1'
const CONVERSATION = 'conv-1'

function ago(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  process.env.AUTOMATION_CRON_SECRET = 'test-secret'
  h.state.automations = [{ account_id: ACCOUNT, trigger_config: { hours: 24 } }]
  h.state.flows = []
  h.state.conversationsByAccount = {}
  h.state.cursors = {}
  h.state.cursorUpserts = []
  runAutomationsForTriggerMock.mockReset()
  runFlowsForTriggerMock.mockReset()
  isContactOptedOutForFollowupMock.mockReset().mockResolvedValue(false)
  logFollowupDispatchMock.mockReset()
  getAccountPlanFeaturesMock.mockReset().mockResolvedValue({ hasFollowup: true })
})

function request(): Request {
  return new Request('https://x/api/automations/inactivity-cron', {
    headers: { 'x-cron-secret': 'test-secret' },
  })
}

describe('hasFollowup gate', () => {
  it('skips the account entirely (no engine dispatch) when the plan lacks hasFollowup', async () => {
    getAccountPlanFeaturesMock.mockResolvedValue({ hasFollowup: false })
    h.state.conversationsByAccount[ACCOUNT] = [{ id: CONVERSATION, contact_id: CONTACT, last_message_at: ago(25) }]

    const res = await GET(request())
    const body = await res.json()

    expect(body.skippedPlan).toBe(1)
    expect(runAutomationsForTriggerMock).not.toHaveBeenCalled()
    expect(runFlowsForTriggerMock).not.toHaveBeenCalled()
  })

  it('proceeds when hasFollowup is true', async () => {
    h.state.conversationsByAccount[ACCOUNT] = [{ id: CONVERSATION, contact_id: CONTACT, last_message_at: ago(25) }]

    const res = await GET(request())
    const body = await res.json()

    expect(body.skippedPlan).toBe(0)
    expect(runAutomationsForTriggerMock).toHaveBeenCalledTimes(1)
  })
})

describe('opt-out pre-check', () => {
  it('never dispatches to either engine for an opted-out contact, and logs the skip', async () => {
    isContactOptedOutForFollowupMock.mockResolvedValue(true)
    h.state.conversationsByAccount[ACCOUNT] = [{ id: CONVERSATION, contact_id: CONTACT, last_message_at: ago(25) }]

    const res = await GET(request())
    const body = await res.json()

    expect(runAutomationsForTriggerMock).not.toHaveBeenCalled()
    expect(runFlowsForTriggerMock).not.toHaveBeenCalled()
    expect(body.skippedOptedOut).toBe(1)
    expect(logFollowupDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: ACCOUNT, conversationId: CONVERSATION, contactId: CONTACT, outcome: 'skipped', reason: 'opted_out' }),
    )
  })

  it('dispatches normally for a contact that is not opted out', async () => {
    h.state.conversationsByAccount[ACCOUNT] = [{ id: CONVERSATION, contact_id: CONTACT, last_message_at: ago(25) }]

    await GET(request())

    expect(runAutomationsForTriggerMock).toHaveBeenCalledTimes(1)
    expect(runFlowsForTriggerMock).toHaveBeenCalledTimes(1)
  })
})

describe('fairness cursor', () => {
  // MAX_CONVERSATIONS_PER_ACCOUNT_PER_TICK is 100 in route.ts (not
  // exported) — mirrored here as a literal; if that constant ever
  // changes, this test's fixture size must change with it.
  const PAGE_SIZE = 100

  it('advances the cursor to the last row when a full page comes back', async () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      id: `conv-${i}`,
      contact_id: `contact-${i}`,
      last_message_at: ago(25 + i),
    }))
    h.state.conversationsByAccount[ACCOUNT] = rows

    await GET(request())

    expect(h.state.cursorUpserts).toHaveLength(1)
    expect(h.state.cursorUpserts[0]).toMatchObject({
      account_id: ACCOUNT,
      last_seen_conversation_id: rows[rows.length - 1].id,
    })
  })

  it('resets the cursor to null when a partial page comes back — the account has been fully cycled', async () => {
    h.state.conversationsByAccount[ACCOUNT] = [{ id: CONVERSATION, contact_id: CONTACT, last_message_at: ago(25) }]
    // Pretend a previous tick had advanced the cursor partway.
    h.state.cursors[ACCOUNT] = { last_seen_last_message_at: ago(30), last_seen_conversation_id: 'some-earlier-conv' }

    await GET(request())

    expect(h.state.cursorUpserts[0]).toMatchObject({
      account_id: ACCOUNT,
      last_seen_last_message_at: null,
      last_seen_conversation_id: null,
    })
  })
})
