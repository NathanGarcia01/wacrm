import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashLeadSourceToken } from '@/lib/leads/token';
import { __resetRateLimitForTests, RATE_LIMITS } from '@/lib/rate-limit';

// Mocks each imported lib function directly (same convention as
// inactivity-cron/route.test.ts): captureLead's own dedup logic is
// covered by capture.test.ts, so here it's a spy — this file tests
// the ROUTE's own concerns (token lookup/isolation, content-type
// parsing, the hasAPI gate, rate limiting, event logging), not
// capture internals. Only `lead_sources`/`lead_source_events` go
// through a minimal fake supabaseAdmin().
const h = vi.hoisted(() => ({
  state: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sources: {} as Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: [] as any[],
  },
}));

vi.mock('@/lib/leads/admin-client', () => {
  const { state } = h;
  return {
    supabaseAdmin: () => ({
      from(table: string) {
        if (table === 'lead_sources') {
          const filters: Record<string, unknown> = {};
          const builder = {
            select: () => builder,
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            maybeSingle: async () => {
              const row = Object.values(state.sources).find((r) =>
                Object.entries(filters).every(([k, v]) => r[k] === v),
              );
              return { data: row ?? null, error: null };
            },
          };
          return builder;
        }
        if (table === 'lead_source_events') {
          return {
            insert: async (row: unknown) => {
              state.events.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`fake db: unexpected table '${table}'`);
      },
    }),
  };
});

const getAccountPlanFeaturesMock = vi.fn();
vi.mock('@/lib/billing/server', () => ({
  getAccountPlanFeatures: (...args: unknown[]) => getAccountPlanFeaturesMock(...args),
}));

const captureLeadMock = vi.fn();
vi.mock('@/lib/leads/capture', () => ({
  captureLead: (...args: unknown[]) => captureLeadMock(...args),
}));

const { POST } = await import('./route');

const TOKEN_A = 'token-account-a';
const TOKEN_B = 'token-account-b';

function seedSource(token: string, accountId: string, overrides: Record<string, unknown> = {}) {
  const hash = hashLeadSourceToken(token);
  h.state.sources[hash] = {
    id: `source-${accountId}`,
    account_id: accountId,
    pipeline_id: 'pipe-1',
    stage_id: 'stage-1',
    lead_origin_id: null,
    created_by: 'user-1',
    is_active: true,
    token_hash: hash,
    ...overrides,
  };
}

function postJson(token: string, body: unknown) {
  return POST(
    new Request(`https://crm.example.com/api/v1/webhooks/in/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

function postForm(token: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return POST(
    new Request(`https://crm.example.com/api/v1/webhooks/in/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  h.state.sources = {};
  h.state.events = [];
  getAccountPlanFeaturesMock.mockReset().mockResolvedValue({ hasAPI: true });
  captureLeadMock.mockReset().mockResolvedValue({
    status: 'ok',
    contactId: 'contact-1',
    contactOutcome: 'created',
    dealId: 'deal-1',
    dealOutcome: 'created',
  });
  __resetRateLimitForTests();
});

afterEach(() => {
  __resetRateLimitForTests();
});

describe('token inválido', () => {
  it('404s for a token that matches no source', async () => {
    const res = await postJson('does-not-exist', { phone: '+5511999990000' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');
    expect(captureLeadMock).not.toHaveBeenCalled();
  });

  it('404s for a deactivated source (does not distinguish it from unknown)', async () => {
    seedSource(TOKEN_A, 'acct-a', { is_active: false });
    const res = await postJson(TOKEN_A, { phone: '+5511999990000' });
    expect(res.status).toBe(404);
  });
});

describe('gate hasAPI', () => {
  it('403s when the account plan lacks hasAPI, without ever calling captureLead', async () => {
    seedSource(TOKEN_A, 'acct-a');
    getAccountPlanFeaturesMock.mockResolvedValue({ hasAPI: false });

    const res = await postJson(TOKEN_A, { phone: '+5511999990000' });
    expect(res.status).toBe(403);
    expect(captureLeadMock).not.toHaveBeenCalled();
  });
});

describe('formulário e JSON', () => {
  it('parses application/json bodies', async () => {
    seedSource(TOKEN_A, 'acct-a');
    const res = await postJson(TOKEN_A, { phone: '+5511999990001', nome: 'Maria' });
    expect(res.status).toBe(201);
    expect(captureLeadMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ phone: '+5511999990001', name: 'Maria' }),
    );
  });

  it('parses application/x-www-form-urlencoded bodies with PT-BR field aliases', async () => {
    seedSource(TOKEN_A, 'acct-a');
    const res = await postForm(TOKEN_A, { telefone: '5511999990002', nome: 'João' });
    expect(res.status).toBe(201);
    expect(captureLeadMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ phone: '5511999990002', name: 'João' }),
    );
  });

  it('400s when the body has no usable phone field', async () => {
    seedSource(TOKEN_A, 'acct-a');
    const res = await postJson(TOKEN_A, { nome: 'Sem telefone' });
    expect(res.status).toBe(400);
    expect(captureLeadMock).not.toHaveBeenCalled();
  });
});

describe('isolamento entre contas', () => {
  it("each token's capture is scoped to its own source's account, never another account's", async () => {
    seedSource(TOKEN_A, 'acct-a');
    seedSource(TOKEN_B, 'acct-b');

    await postJson(TOKEN_A, { phone: '+5511999990003' });
    expect(captureLeadMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-a' }),
      expect.anything(),
    );

    await postJson(TOKEN_B, { phone: '+5511999990004' });
    expect(captureLeadMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-b' }),
      expect.anything(),
    );

    // The event log for each call is tagged with the matching account —
    // token A's traffic never shows up under account B's receipts.
    expect(h.state.events.map((e) => e.account_id)).toEqual(['acct-a', 'acct-b']);
  });
});

describe('rate limit', () => {
  it('429s once a single token exceeds its per-minute budget', async () => {
    seedSource(TOKEN_A, 'acct-a');

    let last!: Response;
    for (let i = 0; i < RATE_LIMITS.leadWebhookIn.limit + 1; i++) {
      last = await postJson(TOKEN_A, { phone: '+5511999990005' });
    }

    expect(last.status).toBe(429);
    const body = await last.json();
    expect(body.error.code).toBe('rate_limited');
    expect(last.headers.get('Retry-After')).toBeTruthy();
  });

  it('is scoped per token — a second source is unaffected by the first one being throttled', async () => {
    seedSource(TOKEN_A, 'acct-a');
    seedSource(TOKEN_B, 'acct-b');

    for (let i = 0; i < RATE_LIMITS.leadWebhookIn.limit + 1; i++) {
      await postJson(TOKEN_A, { phone: '+5511999990006' });
    }
    const res = await postJson(TOKEN_B, { phone: '+5511999990007' });
    expect(res.status).toBe(201);
  });
});
