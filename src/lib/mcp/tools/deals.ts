// ============================================================
// MCP tools: create_deal, move_deal, update_deal.
//
// No `list_deals`/`get_deal` tool — Fase 3B's spec names exactly
// "criar/mover/atualizar negócio" for this resource (unlike contacts/
// tags/pipelines, which explicitly include a "listar"/"buscar" tool).
// A caller needs a `dealId` from `create_deal`'s own result or from
// a contact lookup to call `move_deal`/`update_deal`.
//
// `move_deal` and `update_deal` are split because "mover" (pipeline/
// stage) is the one operation that trips the DB's won/lost triggers
// (`apply_won_stage`, `set_deal_won_at`/`_lost_at`) — worth a tool an
// agent can reach for on purpose, same reasoning the dashboard's
// drag-and-drop gets its own code path.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { resolveApiOwnerId } from '@/lib/api/v1/owner';
import { isUuid } from '@/lib/api/v1/pagination';
import { requireToolScope, toolError, toolJson, wrapTool } from '../tool-helpers';

const SELECT_COLUMNS =
  'id, pipeline_id, stage_id, contact_id, title, value, currency, notes, expected_close_date, status, assigned_to, won_at, lost_at, created_at, updated_at';

async function assertStageInAccount(ctx: ApiKeyContext, pipelineId: string, stageId: string): Promise<boolean> {
  const { data: stage } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, pipeline_id, pipelines!inner(id, account_id)')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();
  const pipelineRow = Array.isArray(stage?.pipelines) ? stage?.pipelines[0] : stage?.pipelines;
  return !!stage && pipelineRow?.account_id === ctx.accountId;
}

export function registerDealTools(server: McpServer, ctx: ApiKeyContext): void {
  server.registerTool(
    'create_deal',
    {
      title: 'Criar negócio',
      description: 'Cria um negócio em um pipeline/etapa, opcionalmente ligado a um contato.',
      inputSchema: {
        pipelineId: z.string(),
        stageId: z.string(),
        contactId: z.string().optional(),
        title: z.string().optional(),
        value: z.number().optional(),
        currency: z.string().optional(),
        notes: z.string().optional(),
        expectedCloseDate: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'deals:write');
      if (!(await assertStageInAccount(ctx, args.pipelineId, args.stageId))) {
        return toolError("'pipelineId'/'stageId' inválido");
      }

      let contactTitle: string | null = null;
      if (args.contactId) {
        const { data: contact } = await ctx.supabase
          .from('contacts')
          .select('id, name, phone')
          .eq('id', args.contactId)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (!contact) return toolError("'contactId' inválido");
        contactTitle = contact.name || contact.phone || null;
      }

      const ownerId = await resolveApiOwnerId(ctx.supabase, ctx.accountId, ctx.createdBy);
      if (!ownerId) return toolError('Não foi possível determinar um responsável nesta conta');

      const title = args.title?.trim() || contactTitle || 'Novo negócio';

      const { data, error } = await ctx.supabase
        .from('deals')
        .insert({
          account_id: ctx.accountId,
          user_id: ownerId,
          pipeline_id: args.pipelineId,
          stage_id: args.stageId,
          contact_id: args.contactId ?? null,
          title,
          value: args.value ?? 0,
          currency: args.currency,
          notes: args.notes?.trim() || null,
          expected_close_date: args.expectedCloseDate ?? null,
        })
        .select(SELECT_COLUMNS)
        .single();

      if (error) return toolError(error.message);
      return toolJson({ deal: data });
    }),
  );

  server.registerTool(
    'move_deal',
    {
      title: 'Mover negócio',
      description:
        'Move um negócio pra outra etapa/pipeline — aciona os mesmos gatilhos de ganho/perda do drag-and-drop no funil.',
      inputSchema: {
        dealId: z.string(),
        pipelineId: z.string(),
        stageId: z.string(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'deals:write');
      if (!isUuid(args.dealId)) return toolError("'dealId' inválido");
      if (!(await assertStageInAccount(ctx, args.pipelineId, args.stageId))) {
        return toolError("'pipelineId'/'stageId' inválido");
      }

      const { data, error } = await ctx.supabase
        .from('deals')
        .update({ pipeline_id: args.pipelineId, stage_id: args.stageId })
        .eq('id', args.dealId)
        .eq('account_id', ctx.accountId)
        .select(SELECT_COLUMNS)
        .maybeSingle();

      if (error) return toolError(error.message);
      if (!data) return toolError('Negócio não encontrado');
      return toolJson({ deal: data });
    }),
  );

  server.registerTool(
    'update_deal',
    {
      title: 'Atualizar negócio',
      description: 'Atualiza título, valor, moeda, notas, status, contato ou data prevista de fechamento.',
      inputSchema: {
        dealId: z.string(),
        title: z.string().optional(),
        value: z.number().optional(),
        currency: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(['open', 'won', 'lost']).optional(),
        contactId: z.string().nullable().optional(),
        expectedCloseDate: z.string().nullable().optional(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'deals:write');
      if (!isUuid(args.dealId)) return toolError("'dealId' inválido");

      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch.title = args.title.trim();
      if (args.value !== undefined) patch.value = args.value;
      if (args.currency !== undefined) patch.currency = args.currency;
      if (args.notes !== undefined) patch.notes = args.notes.trim() || null;
      if (args.status !== undefined) patch.status = args.status;
      if (args.expectedCloseDate !== undefined) patch.expected_close_date = args.expectedCloseDate;

      if (args.contactId !== undefined) {
        if (args.contactId) {
          const { data: contact } = await ctx.supabase
            .from('contacts')
            .select('id')
            .eq('id', args.contactId)
            .eq('account_id', ctx.accountId)
            .maybeSingle();
          if (!contact) return toolError("'contactId' inválido");
        }
        patch.contact_id = args.contactId;
      }

      if (Object.keys(patch).length === 0) return toolError('Nenhum campo para atualizar');

      const { data, error } = await ctx.supabase
        .from('deals')
        .update(patch)
        .eq('id', args.dealId)
        .eq('account_id', ctx.accountId)
        .select(SELECT_COLUMNS)
        .maybeSingle();

      if (error) return toolError(error.message);
      if (!data) return toolError('Negócio não encontrado');
      return toolJson({ deal: data });
    }),
  );
}
