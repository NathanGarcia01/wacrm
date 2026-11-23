// ============================================================
// MCP tool: list_pipelines.
//
// Read-only reference data (no dedicated REST `/api/v1/pipelines`
// endpoint exists — this queries the same tables `POST /api/v1/deals`
// already reads internally to validate `pipelineId`/`stageId`).
// Gated on `deals:read` since there's no standalone pipelines scope
// and this data only matters in service of working with deals.
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { requireToolScope, toolError, toolJson, wrapTool } from '../tool-helpers';

export function registerPipelineTools(server: McpServer, ctx: ApiKeyContext): void {
  server.registerTool(
    'list_pipelines',
    {
      title: 'Listar pipelines e etapas',
      description: 'Lista os pipelines da conta com suas etapas, na ordem configurada.',
      inputSchema: {},
    },
    wrapTool(async () => {
      requireToolScope(ctx, 'deals:read');

      const { data: pipelines, error: pipelinesError } = await ctx.supabase
        .from('pipelines')
        .select('id, name')
        .eq('account_id', ctx.accountId)
        .order('name');
      if (pipelinesError) return toolError(pipelinesError.message);

      const pipelineIds = (pipelines ?? []).map((p) => p.id);
      const { data: stages, error: stagesError } = pipelineIds.length
        ? await ctx.supabase
            .from('pipeline_stages')
            .select('id, pipeline_id, name, position, is_won_stage')
            .in('pipeline_id', pipelineIds)
            .order('position')
        : { data: [] as never[], error: null };
      if (stagesError) return toolError(stagesError.message);

      const items = (pipelines ?? []).map((p) => ({
        ...p,
        stages: (stages ?? []).filter((s) => s.pipeline_id === p.id),
      }));
      return toolJson({ items });
    }),
  );
}
