import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/v1/respond';
import type { ApiKeyContext } from '@/lib/auth/api-context';

// Mocks only `requireMcpContext` — the auth/plan-gate logic itself is
// unit-tested in `src/lib/mcp/auth.test.ts`. This file tests the
// ROUTE's own concerns: JSON-RPC error framing for pre-tool failures,
// and (through the real MCP transport + real tool handlers) that
// per-tool scope checks and account scoping actually hold once a
// request reaches a tool.
const requireMcpContextMock = vi.fn<(req: Request) => Promise<ApiKeyContext>>();
vi.mock('@/lib/mcp/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/auth')>('@/lib/mcp/auth');
  return {
    ...actual,
    requireMcpContext: (req: Request) => requireMcpContextMock(req),
  };
});

const { POST } = await import('./route');

interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

function makeTagsTable(rowsByAccount: Record<string, TagRow[]>) {
  return {
    from(table: string) {
      if (table !== 'tags') throw new Error(`fake db: unexpected table '${table}'`);
      let accountId: string | undefined;
      const builder = {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === 'account_id') accountId = val;
          return builder;
        },
        order: async () => ({ data: rowsByAccount[accountId ?? ''] ?? [], error: null }),
      };
      return builder;
    },
  };
}

function fakeCtx(overrides: Partial<ApiKeyContext>): ApiKeyContext {
  return {
    authType: 'api_key',
    supabase: makeTagsTable({}) as never,
    accountId: 'acct-1',
    keyId: 'key-1',
    scopes: [],
    createdBy: 'user-1',
    ...overrides,
  };
}

function rpcRequest(body: unknown): Request {
  return new Request('https://crm.example.com/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
}

function callTool(name: string, args: Record<string, unknown> = {}) {
  return rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
}

beforeEach(() => {
  requireMcpContextMock.mockReset();
});

describe('autenticação', () => {
  it('maps an unauthorized ApiError (bad/missing key) to a 401 JSON-RPC error, before any tool runs', async () => {
    requireMcpContextMock.mockRejectedValue(new ApiError('unauthorized', 'Missing or invalid API key', 401));

    const res = await POST(callTool('list_tags'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 }, id: null });
  });
});

describe('gate de plano', () => {
  it('maps a forbidden ApiError (plan lacks hasAPI) to a 403 JSON-RPC error', async () => {
    requireMcpContextMock.mockRejectedValue(new ApiError('forbidden', 'sem hasAPI', 403));

    const res = await POST(callTool('list_tags'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe(-32002);
  });
});

describe('rate limit', () => {
  it('maps a rate_limited ApiError to a 429 JSON-RPC error and forwards Retry-After', async () => {
    requireMcpContextMock.mockRejectedValue(
      new ApiError('rate_limited', 'Rate limit exceeded', 429, { 'Retry-After': '42' }),
    );

    const res = await POST(callTool('list_tags'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    const body = await res.json();
    expect(body.error.code).toBe(-32003);
  });
});

describe('escopo read vs write', () => {
  it('rejects a write tool with a read-only key as a tool-level error, not a protocol error', async () => {
    requireMcpContextMock.mockResolvedValue(fakeCtx({ scopes: ['contacts:read'] }));

    const res = await POST(callTool('create_contact', { phone: '+5511999990000' }));
    expect(res.status).toBe(200); // tool errors are 200 at the transport level
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("'contacts:write'");
  });

  it('allows a read tool when the key actually has the read scope', async () => {
    requireMcpContextMock.mockResolvedValue(
      fakeCtx({ accountId: 'acct-1', scopes: ['tags:read'], supabase: makeTagsTable({ 'acct-1': [{ id: 't1', name: 'VIP', color: '#fff', created_at: 'x' }] }) as never }),
    );

    const res = await POST(callTool('list_tags'));
    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    expect(body.result.content[0].text).toContain('VIP');
  });
});

describe('isolamento entre contas', () => {
  it("each call only ever sees its own account's rows, never another account's", async () => {
    const db = makeTagsTable({
      'acct-a': [{ id: 'tag-a', name: 'Conta A', color: '#111', created_at: 'x' }],
      'acct-b': [{ id: 'tag-b', name: 'Conta B', color: '#222', created_at: 'x' }],
    });

    requireMcpContextMock.mockResolvedValue(fakeCtx({ accountId: 'acct-a', scopes: ['tags:read'], supabase: db as never }));
    const resA = await POST(callTool('list_tags'));
    const bodyA = await resA.json();
    expect(bodyA.result.content[0].text).toContain('Conta A');
    expect(bodyA.result.content[0].text).not.toContain('Conta B');

    requireMcpContextMock.mockResolvedValue(fakeCtx({ accountId: 'acct-b', scopes: ['tags:read'], supabase: db as never }));
    const resB = await POST(callTool('list_tags'));
    const bodyB = await resB.json();
    expect(bodyB.result.content[0].text).toContain('Conta B');
    expect(bodyB.result.content[0].text).not.toContain('Conta A');
  });
});
