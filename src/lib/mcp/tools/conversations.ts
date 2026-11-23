// ============================================================
// MCP tools: list_conversations, list_messages (both read-only —
// no `messages:send` tool exists here; sending stays out of MCP
// scope for Fase 3B per the task's explicit limits).
//
// Mirrors `src/app/api/v1/conversations/route.ts` and
// `.../[id]/messages/route.ts`.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { applyCursor, decodeCursor, isUuid, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { requireToolScope, toolError, toolJson, wrapTool } from '../tool-helpers';

const CONV_COLUMNS =
  'id, contact_id, status, assigned_agent_id, channel_id, last_message_text, last_message_at, unread_count, created_at, updated_at';
const MSG_COLUMNS = 'id, conversation_id, sender_type, content_type, content_text, media_url, status, created_at';

export function registerConversationTools(server: McpServer, ctx: ApiKeyContext): void {
  server.registerTool(
    'list_conversations',
    {
      title: 'Listar conversas',
      description: 'Lista conversas da conta, com filtro opcional por contato e status.',
      inputSchema: {
        contactId: z.string().optional(),
        status: z.enum(['open', 'pending', 'closed']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'conversations:read');
      if (args.contactId && !isUuid(args.contactId)) return toolError("'contactId' inválido");

      const limit = parseLimit(args.limit != null ? String(args.limit) : null);
      const cursor = decodeCursor(args.cursor ?? null);

      let query = ctx.supabase
        .from('conversations')
        .select(CONV_COLUMNS)
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);

      if (args.contactId) query = query.eq('contact_id', args.contactId);
      if (args.status) query = query.eq('status', args.status);
      query = applyCursor(query, cursor);

      const { data, error } = await query;
      if (error) return toolError(error.message);

      const { items, nextCursor } = paginate(data ?? [], limit);
      return toolJson({ items, nextCursor });
    }),
  );

  server.registerTool(
    'list_messages',
    {
      title: 'Listar mensagens',
      description: 'Lista mensagens de uma conversa, da mais recente pra mais antiga. Somente leitura.',
      inputSchema: {
        conversationId: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'messages:read');
      if (!isUuid(args.conversationId)) return toolError("'conversationId' inválido");

      const { data: conversation } = await ctx.supabase
        .from('conversations')
        .select('id')
        .eq('id', args.conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!conversation) return toolError('Conversa não encontrada');

      const limit = parseLimit(args.limit != null ? String(args.limit) : null);
      const cursor = decodeCursor(args.cursor ?? null);

      let query = ctx.supabase
        .from('messages')
        .select(MSG_COLUMNS)
        .eq('conversation_id', args.conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      query = applyCursor(query, cursor);

      const { data, error } = await query;
      if (error) return toolError(error.message);

      const { items, nextCursor } = paginate(data ?? [], limit);
      return toolJson({ items, nextCursor });
    }),
  );
}
