// ============================================================
// POST/GET/DELETE /api/v1/mcp — the MCP (Model Context Protocol)
// server endpoint, Streamable HTTP transport (the spec's required
// transport for remote MCP servers).
//
// Auth is the same `wacrm_live_…` API key every `/api/v1/*` REST
// route accepts (`requireMcpContext` = `requireApiKey` + the `hasAPI`
// plan gate), so there's no separate MCP credential or OAuth dance to
// set up — paste the key an admin already has (or mint a new one in
// Settings → API keys) into the MCP client config. Per-key rate limit
// is enforced inside `requireApiKey` itself (`RATE_LIMITS.publicApi`),
// same bucket every REST call already shares.
//
// Stateless: a fresh `WebStandardStreamableHTTPServerTransport` +
// `McpServer` is built per request (`sessionIdGenerator` left
// undefined — see the SDK's own stateless-mode note). Scopes are
// enforced per-tool, not per-connection, by each tool handler.
//
// Failures before a tool ever runs (bad/missing key, wrong plan, over
// the rate limit) are reported as JSON-RPC 2.0 errors — MCP is a
// JSON-RPC protocol end to end, so even a transport-level auth
// failure needs that envelope, not the REST `{error:{code,message}}`
// shape the rest of `/api/v1` uses (see `mcpErrorCode`).
// ============================================================

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { ApiError, mcpErrorCode, requireMcpContext } from '@/lib/mcp/auth';
import { createMcpServer } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonRpcErrorResponse(
  code: number,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function handle(req: Request): Promise<Response> {
  try {
    const ctx = await requireMcpContext(req);

    // Plain JSON responses, not an SSE stream — this server is fully
    // stateless and never pushes server-initiated messages, so there's
    // nothing streaming would buy a caller; it only costs them SSE
    // parsing for a single request/response exchange.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = createMcpServer(ctx);

    try {
      await server.connect(transport);
      return await transport.handleRequest(req);
    } catch (err) {
      console.error('[api/v1/mcp] transport error:', err);
      return jsonRpcErrorResponse(-32603, 'Internal error', 500);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonRpcErrorResponse(mcpErrorCode(err), err.message, err.status, err.headers);
    }
    console.error('[api/v1/mcp] uncategorized error:', err);
    return jsonRpcErrorResponse(-32603, 'Internal error', 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handle(req);
}
