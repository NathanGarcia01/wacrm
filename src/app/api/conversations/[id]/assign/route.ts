import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { assignTicket, findOpenTicket, returnToQueue } from '@/lib/tickets/lifecycle'
import { runTicketSideEffect } from '@/lib/tickets/safe-run'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/conversations/[id]/assign
 *
 * Fase 1 (atendimento), Etapa 4 — replaces the direct client-side
 * `supabase.from('conversations').update({ assigned_agent_id })` that
 * src/components/inbox/message-thread.tsx used to do. The actual
 * assignment write is unchanged (same column, same RLS gate it always
 * had); the only new thing a server round trip buys is a place to
 * mirror onto the open ticket (service-role only, can't run from the
 * browser) — see src/lib/tickets/lifecycle.ts.
 *
 * Body: { agentId: string | null } — null unassigns.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, accountId, userId } = await requireRole('agent')

    const body = await request.json()
    const agentId = (body.agentId ?? null) as string | null

    const { data: existing, error: existingError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) {
      console.error('Error loading conversation for assign:', existingError)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { error: updateError } = await supabase
      .from('conversations')
      .update({ assigned_agent_id: agentId })
      .eq('id', id)
    if (updateError) {
      console.error('Error assigning conversation:', updateError)
      return NextResponse.json({ error: 'Failed to assign conversation' }, { status: 500 })
    }

    await runTicketSideEffect('conversations/assign route', async () => {
      const ticket = await findOpenTicket(id)
      if (!ticket) return
      if (agentId) {
        await assignTicket(ticket.id, agentId, userId)
      } else {
        await returnToQueue(ticket.id, userId)
      }
    })

    return NextResponse.json({ success: true, assigned_agent_id: agentId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
