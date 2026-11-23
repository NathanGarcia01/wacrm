// ============================================================
// MCP tools: list_tags, apply_tag.
//
// No create/remove tag tool — Fase 3B's spec names exactly "listar e
// aplicar tags" for this resource.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { isUuid } from '@/lib/api/v1/pagination';
import { requireToolScope, toolError, toolJson, wrapTool } from '../tool-helpers';

export function registerTagTools(server: McpServer, ctx: ApiKeyContext): void {
  server.registerTool(
    'list_tags',
    {
      title: 'Listar tags',
      description: 'Lista as tags cadastradas na conta.',
      inputSchema: {},
    },
    wrapTool(async () => {
      requireToolScope(ctx, 'tags:read');
      const { data, error } = await ctx.supabase
        .from('tags')
        .select('id, name, color, created_at')
        .eq('account_id', ctx.accountId)
        .order('name');
      if (error) return toolError(error.message);
      return toolJson({ items: data ?? [] });
    }),
  );

  server.registerTool(
    'apply_tag',
    {
      title: 'Aplicar tag a um contato',
      description:
        'Vincula uma tag existente a um contato. Sem erro se já estava vinculada (o estado final já é o pedido).',
      inputSchema: {
        contactId: z.string(),
        tagId: z.string(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'tags:write');
      if (!isUuid(args.contactId) || !isUuid(args.tagId)) {
        return toolError("'contactId'/'tagId' inválido");
      }

      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('id', args.contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contact) return toolError('Contato não encontrado');

      const { data: tag } = await ctx.supabase
        .from('tags')
        .select('id')
        .eq('id', args.tagId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!tag) return toolError('Tag não encontrada');

      const { error } = await ctx.supabase.from('contact_tags').insert({ contact_id: args.contactId, tag_id: args.tagId });
      if (error && !isUniqueViolation(error)) return toolError(error.message);
      return toolJson({ linked: true });
    }),
  );
}
