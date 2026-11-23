import { describe, expect, it } from 'vitest';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { ToolScopeError, requireToolScope, toolError, toolJson, wrapTool } from './tool-helpers';

function fakeCtx(scopes: string[]): ApiKeyContext {
  return {
    authType: 'api_key',
    supabase: {} as never,
    accountId: 'acct-1',
    keyId: 'key-1',
    scopes,
    createdBy: 'user-1',
  };
}

describe('requireToolScope', () => {
  it('does not throw when the key has the scope', () => {
    expect(() => requireToolScope(fakeCtx(['contacts:read', 'deals:write']), 'contacts:read')).not.toThrow();
  });

  it('throws ToolScopeError when the key lacks the scope', () => {
    expect(() => requireToolScope(fakeCtx(['contacts:read']), 'contacts:write')).toThrow(ToolScopeError);
  });

  it('throws for a key with no scopes at all', () => {
    expect(() => requireToolScope(fakeCtx([]), 'tags:read')).toThrow(ToolScopeError);
  });
});

describe('toolJson / toolError', () => {
  it('toolJson wraps the payload as pretty-printed JSON text, not an error', () => {
    const result = toolJson({ a: 1 });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }]);
  });

  it('toolError sets isError true', () => {
    const result = toolError('deu ruim');
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'deu ruim' }]);
  });
});

describe('wrapTool', () => {
  it('passes through a successful result unchanged', async () => {
    const tool = wrapTool(async () => toolJson({ ok: true }));
    const result = await tool(undefined);
    expect(result.isError).toBeUndefined();
  });

  it('converts a thrown ToolScopeError into an isError result instead of rejecting', async () => {
    const tool = wrapTool(async (ctx: ApiKeyContext) => {
      requireToolScope(ctx, 'tags:write');
      return toolJson({ unreachable: true });
    });

    const result = await tool(fakeCtx(['tags:read']));
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("'tags:write'") });
  });

  it('converts any other thrown error into an isError result rather than crashing', async () => {
    const tool = wrapTool(async () => {
      throw new Error('boom');
    });

    const result = await tool(undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'boom' });
  });
});
