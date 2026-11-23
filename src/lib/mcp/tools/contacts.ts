// ============================================================
// MCP tools: search_contacts, create_contact, update_contact.
//
// Mirrors `src/app/api/v1/contacts/route.ts` and `.../[id]/route.ts`
// field-for-field (same dedup rule, same account scoping) — kept as
// its own small implementation rather than importing the REST route
// handlers, which take `Request`/return `NextResponse` and aren't
// reusable as plain functions. Any contact-shape change needs to
// land in both places.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { resolveApiOwnerId } from '@/lib/api/v1/owner';
import { applyCursor, decodeCursor, isUuid, paginate, parseLimit } from '@/lib/api/v1/pagination';
import { requireToolScope, toolError, toolJson, wrapTool } from '../tool-helpers';

const SELECT_COLUMNS = 'id, name, phone, email, company, status_id, lead_origin_id, created_at, updated_at';

export function registerContactTools(server: McpServer, ctx: ApiKeyContext): void {
  server.registerTool(
    'search_contacts',
    {
      title: 'Buscar contatos',
      description: 'Lista/filtra contatos da conta por telefone, email, status ou origem do lead.',
      inputSchema: {
        phone: z.string().optional().describe('Telefone, com ou sem formatação'),
        email: z.string().optional(),
        statusId: z.string().optional().describe('uuid de contact_statuses'),
        leadOriginId: z.string().optional().describe('uuid de lead_origins'),
        limit: z.number().int().min(1).max(100).optional().describe('padrão 25, máximo 100'),
        cursor: z.string().optional().describe('cursor retornado por uma chamada anterior'),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'contacts:read');

      const limit = parseLimit(args.limit != null ? String(args.limit) : null);
      const cursor = decodeCursor(args.cursor ?? null);

      let query = ctx.supabase
        .from('contacts')
        .select(SELECT_COLUMNS)
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);

      if (args.phone) query = query.eq('phone_normalized', normalizePhone(args.phone));
      if (args.email) query = query.eq('email', args.email);
      if (args.statusId) query = query.eq('status_id', args.statusId);
      if (args.leadOriginId) query = query.eq('lead_origin_id', args.leadOriginId);
      query = applyCursor(query, cursor);

      const { data, error } = await query;
      if (error) return toolError(error.message);

      const { items, nextCursor } = paginate(data ?? [], limit);
      return toolJson({ items, nextCursor });
    }),
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Criar contato',
      description:
        'Cria um contato novo ou retorna o existente, casado por telefone — mesma regra de dedup usada em todo o app.',
      inputSchema: {
        phone: z.string().describe('Telefone — obrigatório'),
        name: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional(),
        statusId: z.string().optional(),
        leadOriginId: z.string().optional(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'contacts:write');

      const phone = args.phone.trim();
      if (!phone || normalizePhone(phone).length < 8) {
        return toolError("'phone' precisa ser um telefone válido");
      }

      const existing = await findExistingContact(ctx.supabase, ctx.accountId, phone);
      if (existing) {
        const { data } = await ctx.supabase.from('contacts').select(SELECT_COLUMNS).eq('id', existing.id).single();
        return toolJson({ contact: data, outcome: 'matched' });
      }

      const ownerId = await resolveApiOwnerId(ctx.supabase, ctx.accountId, ctx.createdBy);
      if (!ownerId) return toolError('Não foi possível determinar um responsável nesta conta');

      const { data, error } = await ctx.supabase
        .from('contacts')
        .insert({
          account_id: ctx.accountId,
          user_id: ownerId,
          phone,
          name: args.name?.trim() || null,
          email: args.email?.trim() || null,
          company: args.company?.trim() || null,
          status_id: args.statusId ?? null,
          lead_origin_id: args.leadOriginId ?? null,
        })
        .select(SELECT_COLUMNS)
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          const retried = await findExistingContact(ctx.supabase, ctx.accountId, phone);
          if (retried) {
            const { data: data2 } = await ctx.supabase
              .from('contacts')
              .select(SELECT_COLUMNS)
              .eq('id', retried.id)
              .single();
            return toolJson({ contact: data2, outcome: 'matched' });
          }
        }
        return toolError(error.message);
      }
      return toolJson({ contact: data, outcome: 'created' });
    }),
  );

  server.registerTool(
    'update_contact',
    {
      title: 'Atualizar contato',
      description: 'Atualiza campos de um contato existente.',
      inputSchema: {
        contactId: z.string(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional(),
        statusId: z.string().optional(),
        leadOriginId: z.string().optional(),
      },
    },
    wrapTool(async (args) => {
      requireToolScope(ctx, 'contacts:write');
      if (!isUuid(args.contactId)) return toolError("'contactId' inválido");

      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name.trim() || null;
      if (args.phone !== undefined) {
        if (normalizePhone(args.phone).length < 8) return toolError("'phone' inválido");
        patch.phone = args.phone.trim();
      }
      if (args.email !== undefined) patch.email = args.email.trim() || null;
      if (args.company !== undefined) patch.company = args.company.trim() || null;
      if (args.statusId !== undefined) patch.status_id = args.statusId;
      if (args.leadOriginId !== undefined) patch.lead_origin_id = args.leadOriginId;

      if (Object.keys(patch).length === 0) return toolError('Nenhum campo para atualizar');

      const { data, error } = await ctx.supabase
        .from('contacts')
        .update(patch)
        .eq('id', args.contactId)
        .eq('account_id', ctx.accountId)
        .select(SELECT_COLUMNS)
        .maybeSingle();

      if (error) {
        if (isUniqueViolation(error)) return toolError('Outro contato nesta conta já usa esse telefone');
        return toolError(error.message);
      }
      if (!data) return toolError('Contato não encontrado');
      return toolJson({ contact: data });
    }),
  );
}
