// ============================================================
// Builds a fresh `McpServer` per request, with every tool closed
// over the resolved `ApiKeyContext`. Stateless by design — same as
// `src/app/api/v1/mcp/route.ts`'s transport: no session, no shared
// state between requests, so there's nothing to clean up and no
// cross-request leakage to worry about between different callers'
// keys.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { registerContactTools } from './tools/contacts';
import { registerConversationTools } from './tools/conversations';
import { registerDealTools } from './tools/deals';
import { registerTagTools } from './tools/tags';
import { registerPipelineTools } from './tools/pipelines';

export function createMcpServer(ctx: ApiKeyContext): McpServer {
  const server = new McpServer({ name: 'funilly-mcp', version: '1.0.0' });

  registerContactTools(server, ctx);
  registerConversationTools(server, ctx);
  registerDealTools(server, ctx);
  registerTagTools(server, ctx);
  registerPipelineTools(server, ctx);

  return server;
}
