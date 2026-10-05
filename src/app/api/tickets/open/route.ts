import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assignTicket, openTicketIfNeeded } from "@/lib/tickets/lifecycle";

/**
 * POST /api/tickets/open
 *
 * Fase 1 (atendimento), Etapa 6 — the chat header's "Abrir
 * atendimento" button, shown when the conversation has no OPEN
 * ticket (never had one, or its latest one is closed). Unlike every
 * inbound-message/manual-send path, this isn't triggered by a
 * message — it's an explicit agent action on an otherwise-idle
 * conversation, so it opens with source='manual_outbound',
 * initiated_by='company' and immediately assigns the clicking agent
 * (status → in_progress) rather than leaving it pending in the
 * queue — "já atribuído a quem clicou", per the approved plan.
 *
 * No-ops safely into the existing ticket if one raced open in the
 * meantime (e.g. the customer messaged at the same moment): doesn't
 * reassign a ticket it didn't create.
 *
 * Body: { conversationId: string }
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireRole("agent");

    const body = await request.json();
    const conversationId = body.conversationId as string | undefined;
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    // RLS scopes this to the caller's account — a conversation from
    // another account 404s here.
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) {
      console.error("[POST /api/tickets/open] load error:", error);
      return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
    }
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { ticket, created } = await openTicketIfNeeded(conversationId, {
      source: "manual_outbound",
      initiatedBy: "company",
      actorId: userId,
    });

    const finalTicket = created ? await assignTicket(ticket.id, userId, userId) : ticket;
    return NextResponse.json({ ticket: finalTicket });
  } catch (err) {
    return toErrorResponse(err);
  }
}
