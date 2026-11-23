// ============================================================
// Shared helpers for MCP tool handlers (`src/lib/mcp/tools/*`).
//
// Tool-level errors (missing scope, bad input, a Supabase error) are
// NOT JSON-RPC protocol errors — the MCP spec wants those surfaced as
// a normal `CallToolResult` with `isError: true`, so the model sees
// the failure as part of the conversation instead of the connection
// dying. Protocol-level errors (auth/plan-gate/rate-limit, before any
// tool runs) are handled separately in `src/lib/mcp/auth.ts` +
// `src/app/api/v1/mcp/route.ts`.
// ============================================================

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { hasScope, type ApiScope } from '@/lib/api-keys/scopes';
import type { ApiKeyContext } from '@/lib/auth/api-context';

/** Thrown by `requireToolScope`; caught by `wrapTool` and turned into
 *  an `isError` tool result — never a thrown exception past this layer. */
export class ToolScopeError extends Error {
  constructor(public readonly scope: ApiScope) {
    super(`Esta chave de API não tem o escopo '${scope}'`);
    this.name = 'ToolScopeError';
  }
}

/** Call at the top of every tool handler, before touching the DB —
 *  mirrors the `requireApiKey(request, scope)` check every REST route
 *  does, just scoped per-tool instead of per-route. */
export function requireToolScope(ctx: ApiKeyContext, scope: ApiScope): void {
  if (!hasScope(ctx.scopes, scope)) {
    throw new ToolScopeError(scope);
  }
}

export function toolJson(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Wraps a tool callback so any thrown error (scope check, or an
 * unexpected Supabase/JS error) becomes an `isError` result instead
 * of crashing the request. Tool handlers themselves still return
 * `toolError(...)` directly for *expected* failures (not found,
 * invalid id, duplicate) — this is the backstop for everything else.
 */
export function wrapTool<Args>(
  fn: (args: Args) => Promise<CallToolResult>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof ToolScopeError) return toolError(err.message);
      console.error('[mcp tool] unexpected error:', err);
      return toolError(err instanceof Error ? err.message : 'Erro interno');
    }
  };
}
