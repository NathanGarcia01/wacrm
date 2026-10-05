import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { transferTicket, TicketClosedError, TicketNotFoundError } from "@/lib/tickets/lifecycle";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tickets/[id]/transfer
 *
 * Fase 1 (atendimento), Etapa 6 — the inbox header's "Transferir"
 * action: to another agent, or to a department with nobody assigned
 * yet. Body shape mirrors TransferTicketTarget exactly:
 *   - { agentId: string }                      → to a person (keeps department, if any; status → in_progress)
 *   - { agentId: null, departmentId: string }   → to a department, unassigned (status → pending)
 * `agentId: undefined` (omitted) leaves the current assignment
 * untouched — not used by the dialog today, but transferTicket
 * supports it (department-only move).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, userId } = await requireRole("agent");

    const body = await request.json();
    const hasAgentId = Object.prototype.hasOwnProperty.call(body, "agentId");
    const hasDepartmentId = Object.prototype.hasOwnProperty.call(body, "departmentId");
    if (!hasAgentId && !hasDepartmentId) {
      return NextResponse.json(
        { error: "agentId and/or departmentId is required" },
        { status: 400 },
      );
    }

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[POST /api/tickets/[id]/transfer] load error:", error);
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const updated = await transferTicket(
      id,
      {
        ...(hasAgentId ? { toAgentId: body.agentId as string | null } : {}),
        ...(hasDepartmentId ? { toDepartmentId: body.departmentId as string | null } : {}),
      },
      userId,
    );
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
