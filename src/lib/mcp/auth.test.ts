import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApiError } from '@/lib/api/v1/respond';
import type { ApiKeyContext } from '@/lib/auth/api-context';

const requireApiKeyMock = vi.fn<(request: Request, scope?: string) => Promise<ApiKeyContext>>();
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: (request: Request, scope?: string) => requireApiKeyMock(request, scope),
}));

const getAccountPlanFeaturesMock = vi.fn();
vi.mock('@/lib/billing/server', () => ({
  getAccountPlanFeatures: (...args: unknown[]) => getAccountPlanFeaturesMock(...args),
}));

const { requireMcpContext, mcpErrorCode } = await import('./auth');

function fakeCtx(overrides: Partial<ApiKeyContext> = {}): ApiKeyContext {
  return {
    authType: 'api_key',
    supabase: {} as never,
    accountId: 'acct-1',
    keyId: 'key-1',
    scopes: ['contacts:read'],
    createdBy: 'user-1',
    ...overrides,
  };
}

const req = new Request('https://crm.example.com/api/v1/mcp', { method: 'POST' });

beforeEach(() => {
  requireApiKeyMock.mockReset();
  getAccountPlanFeaturesMock.mockReset();
});

describe('requireMcpContext', () => {
  it('returns the resolved context when the key is valid and the plan has hasAPI', async () => {
    const ctx = fakeCtx();
    requireApiKeyMock.mockResolvedValue(ctx);
    getAccountPlanFeaturesMock.mockResolvedValue({ hasAPI: true });

    await expect(requireMcpContext(req)).resolves.toBe(ctx);
  });

  it('propagates requireApiKey failures unchanged (unauthorized/rate-limited/etc.)', async () => {
    const apiErr = new ApiError('unauthorized', 'Missing or invalid API key', 401);
    requireApiKeyMock.mockRejectedValue(apiErr);

    await expect(requireMcpContext(req)).rejects.toBe(apiErr);
    expect(getAccountPlanFeaturesMock).not.toHaveBeenCalled();
  });

  it('throws forbidden when the account plan lacks hasAPI, even with a valid key', async () => {
    requireApiKeyMock.mockResolvedValue(fakeCtx());
    getAccountPlanFeaturesMock.mockResolvedValue({ hasAPI: false });

    const promise = requireMcpContext(req);
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await promise.catch((err: ApiError) => {
      expect(err.code).toBe('forbidden');
      expect(err.status).toBe(403);
    });
  });
});

describe('mcpErrorCode', () => {
  it.each([
    ['unauthorized', -32001],
    ['forbidden', -32002],
    ['rate_limited', -32003],
    ['not_found', -32004],
    ['bad_request', -32602],
    ['internal', -32603],
  ] as const)('maps %s to %d', (code, expected) => {
    expect(mcpErrorCode(new ApiError(code, 'x', 500))).toBe(expected);
  });
});
