import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const PAGE_SIZE = 50

/**
 * GET /api/settings/routing/audit
 *
 * Fase 1 (distribuição automática de tickets) — Etapa 2. Últimas
 * atribuições automáticas (routing_assignment_events), mais recentes
 * primeiro. Admin+ apenas — mesma visibilidade da RLS select policy
 * da tabela (migration 129), checada de novo aqui porque a tela
 * busca os nomes dos agentes via join manual (profiles), que por si
 * só é visível a qualquer membro.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: events, error } = await supabase
      .from('routing_assignment_events')
      .select('id, ticket_id, agent_id, mode, reason, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (error) {
      console.error('[GET /api/settings/routing/audit] load error:', error)
      return NextResponse.json({ error: 'Failed to load routing audit' }, { status: 500 })
    }

    const agentIds = [...new Set((events ?? []).map((e) => e.agent_id as string))]
    const ticketIds = [...new Set((events ?? []).map((e) => e.ticket_id as string))]

    const [{ data: agents }, { data: tickets }] = await Promise.all([
      agentIds.length
        ? supabase.from('profiles').select('user_id, full_name, email').in('user_id', agentIds)
        : Promise.resolve({ data: [] as { user_id: string; full_name: string | null; email: string }[] }),
      ticketIds.length
        ? supabase.from('tickets').select('id, protocol_number').in('id', ticketIds)
        : Promise.resolve({ data: [] as { id: string; protocol_number: number }[] }),
    ])
    const agentNameById = new Map((agents ?? []).map((a) => [a.user_id as string, (a.full_name as string | null) || (a.email as string)]))
    const protocolById = new Map((tickets ?? []).map((t) => [t.id as string, t.protocol_number as number]))

    return NextResponse.json({
      events: (events ?? []).map((e) => ({
        id: e.id,
        ticketId: e.ticket_id,
        ticketProtocol: protocolById.get(e.ticket_id as string) ?? null,
        agentId: e.agent_id,
        agentName: agentNameById.get(e.agent_id as string) ?? null,
        mode: e.mode,
        reason: e.reason,
        createdAt: e.created_at,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
