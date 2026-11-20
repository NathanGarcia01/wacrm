import { describe, expect, it, vi, beforeEach } from 'vitest'

// Fase 2 (Follow-up seguro) — B3. Mesma convenção de
// inactivity-cron/route.test.ts: mocka as funções de
// inactivity-followup.ts e getAccountPlanFeatures como spies, e só a
// consulta própria da rota (automations/flows/conversations) passa
// por um fake supabaseAdmin() mínimo.
const h = vi.hoisted(() => ({
  state: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    automations: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flows: [] as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversationsByAccount: {} as Record<string, any[]>,
  },
}))

vi.mock('@/lib/automations/admin-client', () => {
  const { state } = h
  function builder(table: string) {
    const filters: [string, unknown][] = []
    const getEq = (k: string) => filters.find((f) => f[0] === k)?.[1]
    const resolve = () => {
      if (table === 'automations') return { data: state.automations, error: null }
      if (table === 'flows') return { data: state.flows, error: null }
      if (table === 'conversations') {
        const accountId = getEq('account_id') as string
        return { data: state.conversationsByAccount[accountId] ?? [], error: null }
      }
      return { data: null, error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      lt: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }
  return { supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }
})

const mocks = vi.hoisted(() => ({
  isContactOptedOutForFollowup: vi.fn(),
  evaluateInactivityFollowupGuards: vi.fn(),
  logFollowupDispatch: vi.fn(),
  getAccountPlanFeatures: vi.fn(),
}))

vi.mock('@/lib/automations/inactivity-followup', () => ({
  isContactOptedOutForFollowup: mocks.isContactOptedOutForFollowup,
  evaluateInactivityFollowupGuards: mocks.evaluateInactivityFollowupGuards,
  logFollowupDispatch: mocks.logFollowupDispatch,
}))

vi.mock('@/lib/billing/server', () => ({
  getAccountPlanFeatures: mocks.getAccountPlanFeatures,
}))

const isContactOptedOutForFollowupMock = mocks.isContactOptedOutForFollowup
const evaluateInactivityFollowupGuardsMock = mocks.evaluateInactivityFollowupGuards
const logFollowupDispatchMock = mocks.logFollowupDispatch
const getAccountPlanFeaturesMock = mocks.getAccountPlanFeatures

import { GET } from './route'

const ACCOUNT = 'acct-1'
const CONTACT = 'contact-1'
const CONVERSATION = 'conv-1'
const AUTOMATION = 'auto-1'

function ago(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  process.env.AUTOMATION_CRON_SECRET = 'test-secret'
  h.state.automations = [{ id: AUTOMATION, account_id: ACCOUNT, trigger_config: { hours: 24 } }]
  h.state.flows = []
  h.state.conversationsByAccount = {
    [ACCOUNT]: [{ id: CONVERSATION, contact_id: CONTACT, last_message_at: ago(25) }],
  }
  isContactOptedOutForFollowupMock.mockReset().mockResolvedValue(false)
  evaluateInactivityFollowupGuardsMock.mockReset().mockResolvedValue({ fire: true })
  logFollowupDispatchMock.mockReset()
  getAccountPlanFeaturesMock.mockReset().mockResolvedValue({ hasFollowup: true })
})

function request(qs = ''): Request {
  return new Request(`https://x/api/automations/inactivity-dry-run${qs}`, {
    headers: { 'x-cron-secret': 'test-secret' },
  })
}

describe('auth', () => {
  it('rejects without the cron secret', async () => {
    const res = await GET(new Request('https://x/api/automations/inactivity-dry-run'))
    expect(res.status).toBe(401)
  })
})

describe('hasFollowup gate', () => {
  it('skips the account entirely when the plan lacks hasFollowup', async () => {
    getAccountPlanFeaturesMock.mockResolvedValue({ hasFollowup: false })

    const res = await GET(request())
    const body = await res.json()

    expect(body.skippedPlan).toBe(1)
    expect(logFollowupDispatchMock).not.toHaveBeenCalled()
  })
})

describe('opted-out conversation', () => {
  it('logs a dry_run skip with reason opted_out and never evaluates guards', async () => {
    isContactOptedOutForFollowupMock.mockResolvedValue(true)

    const res = await GET(request())
    const body = await res.json()

    expect(evaluateInactivityFollowupGuardsMock).not.toHaveBeenCalled()
    expect(body.bySkipReason.opted_out).toBe(1)
    expect(logFollowupDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: ACCOUNT,
        conversationId: CONVERSATION,
        contactId: CONTACT,
        outcome: 'skipped',
        reason: 'opted_out',
        mode: 'dry_run',
      }),
    )
  })
})

describe('would-send preview', () => {
  it('logs a dry_run "sent" row (never a real dispatch) when the guards would allow it', async () => {
    evaluateInactivityFollowupGuardsMock.mockResolvedValue({ fire: true })

    const res = await GET(request())
    const body = await res.json()

    expect(body.wouldSend).toBe(1)
    expect(logFollowupDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: ACCOUNT,
        automationId: AUTOMATION,
        conversationId: CONVERSATION,
        contactId: CONTACT,
        outcome: 'sent',
        mode: 'dry_run',
      }),
    )
  })

  it('logs a dry_run skip with the guard reason, grouped in the summary', async () => {
    evaluateInactivityFollowupGuardsMock.mockResolvedValue({ fire: false, reason: 'daily_cap_reached' })

    const res = await GET(request())
    const body = await res.json()

    expect(body.wouldSend).toBe(0)
    expect(body.bySkipReason.daily_cap_reached).toBe(1)
    expect(logFollowupDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'skipped', reason: 'daily_cap_reached', mode: 'dry_run' }),
    )
  })

  it('does not log anything for a silent last_sender mismatch (fire:false, no reason)', async () => {
    evaluateInactivityFollowupGuardsMock.mockResolvedValue({ fire: false })

    const res = await GET(request())
    const body = await res.json()

    expect(body.wouldSend).toBe(0)
    expect(Object.keys(body.bySkipReason)).toHaveLength(0)
    expect(logFollowupDispatchMock).not.toHaveBeenCalled()
  })

  it('every logged row uses mode dry_run, never live', async () => {
    evaluateInactivityFollowupGuardsMock.mockResolvedValue({ fire: false, reason: 'max_attempts_reached' })

    await GET(request())

    for (const call of logFollowupDispatchMock.mock.calls) {
      expect(call[1]).toMatchObject({ mode: 'dry_run' })
    }
  })
})

describe('?accountId= filter', () => {
  it('restricts the scan to a single account when provided', async () => {
    const OTHER_ACCOUNT = 'acct-2'
    h.state.automations = [
      { id: AUTOMATION, account_id: ACCOUNT, trigger_config: { hours: 24 } },
      { id: 'auto-2', account_id: OTHER_ACCOUNT, trigger_config: { hours: 24 } },
    ]
    h.state.conversationsByAccount[OTHER_ACCOUNT] = [
      { id: 'conv-2', contact_id: 'contact-2', last_message_at: ago(25) },
    ]

    await GET(request(`?accountId=${ACCOUNT}`))

    expect(getAccountPlanFeaturesMock).toHaveBeenCalledTimes(1)
    expect(getAccountPlanFeaturesMock).toHaveBeenCalledWith(expect.anything(), ACCOUNT)
  })
})
