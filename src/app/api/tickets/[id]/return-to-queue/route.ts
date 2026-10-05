import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { returnToQueue, TicketClosedError, TicketNotFoundError } from "@/lib/tickets/lifecycle";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tickets/[id]/return-to-queue
 *
 * Fase 1 (atendimento), Etapa 6 — the inbox header's "Devolver à
 * fila" action: unassigns the agent, status → pending, department_id
 * untouched (see returnToQueue's doc comment in lifecycle.ts).
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, userId } = await requireRole("agent");

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[POST /api/tickets/[id]/return-to-queue] load error:", error);
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const updated = await returnToQueue(id, userId);
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
