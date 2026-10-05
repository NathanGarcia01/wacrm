import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assignTicket, TicketClosedError, TicketNotFoundError } from "@/lib/tickets/lifecycle";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tickets/[id]/assign
 *
 * Fase 1 (atendimento), Etapa 6 — the inbox header's "Atribuir"
 * action (a mim / a outro agente), only rendered when
 * accounts.tickets_ui_enabled is true. Unlike the pre-Etapa-6
 * /api/conversations/[id]/assign route (which mirrors onto the
 * ticket as a best-effort side effect of a conversation write), this
 * IS the action — errors must reach the UI, not be swallowed.
 *
 * Body: { agentId: string } — always a real agent, never null; use
 * /return-to-queue to unassign.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, userId } = await requireRole("agent");

    const body = await request.json();
    const agentId = body.agentId as string | undefined;
    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    // RLS (tickets_select) already scopes this to the caller's
    // account — a ticket from another account 404s here rather than
    // reaching assignTicket's own account-membership check below.
    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[POST /api/tickets/[id]/assign] load error:", error);
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const updated = await assignTicket(id, agentId, userId);
    return NextResponse.json({ ticket: updated });
  } catch (err) {
    if (err instanceof TicketNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof TicketClosedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return toErrorResponse(err);
  }
}
