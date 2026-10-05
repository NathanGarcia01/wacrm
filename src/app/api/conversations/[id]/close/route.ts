import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { closeTicketWithoutReason } from '@/lib/tickets/lifecycle'
import { runTicketSideEffect } from '@/lib/tickets/safe-run'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/conversations/[id]/close
 *
 * Fase 1 (atendimento), Etapa 4 — replaces the direct client-side
 * `supabase.from('conversations').update({ status: 'closed' })` for
 * the "closed" case specifically (message-thread.tsx's status dropdown
 * still writes 'open'/'pending' directly — no ticket action maps to
 * those yet). The NPS auto-send and `conversation_closed` automation
 * trigger still happen client-side after this call succeeds, unchanged.
 *
 * Closes the mirrored ticket (if any) with the seeded
 * "Encerrado (sem motivo informado)" system reason — see
 * closeTicketWithoutReason's doc comment for why: the UI here doesn't
 * collect a reason yet (that's Fase 1 Etapa 6), and the DB requires one.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, accountId, userId } = await requireRole('agent')

    const { data: existing, error: existingError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) {
      console.error('Error loading conversation for close:', existingError)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { error: updateError } = await supabase
      .from('conversations')
      .update({ status: 'closed' })
      .eq('id', id)
    if (updateError) {
      console.error('Error closing conversation:', updateError)
      return NextResponse.json({ error: 'Failed to close conversation' }, { status: 500 })
    }

    await runTicketSideEffect('conversations/close route', async () => {
      await closeTicketWithoutReason(id, userId)
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
