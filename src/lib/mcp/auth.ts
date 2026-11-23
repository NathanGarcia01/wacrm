// ============================================================
// MCP endpoint auth — the same api_keys Bearer auth every other
// `/api/v1/*` route uses (`requireApiKey`), plus the Fase 3B `hasAPI`
// plan gate (same billing dimension as the Fase 3A lead-capture
// webhook — MCP access is a Business-plan feature).
//
// No new credential type: an MCP client authenticates with the same
// `wacrm_live_…` key created in Settings → API keys, and gets the
// same per-key rate limit (`requireApiKey` already checks
// `RATE_LIMITS.publicApi` before this ever runs). Per-tool scope
// checks happen one level down, inside each tool handler
// (`src/lib/mcp/tool-helpers.ts`'s `requireToolScope`) — exactly like
// REST routes check `contacts:write` etc., just surfaced as a tool
// result instead of an HTTP status.
// ============================================================

import { requireApiKey, type ApiKeyContext } from '@/lib/auth/api-context';
import { getAccountPlanFeatures } from '@/lib/billing/server';
import { ApiError, forbidden } from '@/lib/api/v1/respond';

export async function requireMcpContext(request: Request): Promise<ApiKeyContext> {
  const ctx = await requireApiKey(request);
  const features = await getAccountPlanFeatures(ctx.supabase, ctx.accountId);
  if (!features.hasAPI) {
    throw forbidden('O servidor MCP não está disponível no plano atual desta conta');
  }
  return ctx;
}

/**
 * Maps a REST-style `ApiError` to the JSON-RPC 2.0 error shape the MCP
 * transport expects on the wire. `-32602`/`-32603` are the JSON-RPC
 * spec's own reserved codes (Invalid params / Internal error); the
 * rest are implementation-defined codes in the `-32000..-32099`
 * server-error range the MCP/JSON-RPC spec reserves for exactly this
 * (transport/auth failures before any tool ever runs).
 */
export function mcpErrorCode(err: ApiError): number {
  switch (err.code) {
    case 'unauthorized':
      return -32001;
    case 'forbidden':
      return -32002;
    case 'rate_limited':
      return -32003;
    case 'not_found':
      return -32004;
    case 'bad_request':
      return -32602;
    case 'internal':
    default:
      return -32603;
  }
}

export { ApiError };
