import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { closeTicket, TicketClosedError, TicketNotFoundError } from "@/lib/tickets/lifecycle";
import { sendNpsSurvey } from "@/lib/nps/send-survey";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tickets/[id]/close
 *
 * Fase 1 (atendimento), Etapa 6 — the mandatory-reason close dialog.
 * Unlike /api/conversations/[id]/close (which always closes with the
 * seeded 'no_reason_informed' placeholder via closeTicketWithoutReason),
 * this is the real thing: a required, non-system closing reason.
 *
 * `closeTicket` itself only checks the reason belongs to the ticket's
 * account — it does NOT reject `is_system` reasons (closeTicketWithoutReason
 * legitimately passes one). So THIS route is what actually guarantees
 * "no path to close without a real reason": it rejects `is_system`
 * reasons explicitly, before ever calling closeTicket.
 *
 * Body: { closingReasonId: string, note?: string }
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, accountId, userId } = await requireRole("agent");

    const body = await request.json();
    const closingReasonId = body.closingReasonId as string | undefined;
    const note = (body.note as string | undefined)?.trim() || undefined;
    if (!closingReasonId) {
      return NextResponse.json({ error: "closingReasonId is required" }, { status: 400 });
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (ticketError) {
      console.error("[POST /api/tickets/[id]/close] ticket load error:", ticketError);
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const { data: reason, error: reasonError } = await supabase
      .from("closing_reasons")
      .select("id, is_system")
      .eq("id", closingReasonId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (reasonError) {
      console.error("[POST /api/tickets/[id]/close] reason load error:", reasonError);
      return NextResponse.json({ error: "Failed to load closing reason" }, { status: 500 });
    }
    if (!reason) {
      return NextResponse.json({ error: "Closing reason not found" }, { status: 404 });
    }
    if (reason.is_system) {
      return NextResponse.json(
        { error: "System closing reasons cannot be used here — pick a real reason" },
        { status: 400 },
      );
    }

    const updated = await closeTicket(id, closingReasonId, userId, note);

    // Mirrors the automations/flows close_conversation step (engine.ts)
    // — this mandatory-reason dialog is the PRIMARY manual-close path
    // since Fase 1 Etapa 6, and never got this call when it replaced
    // the old UI, silently breaking NPS for every agent-initiated
    // close. Best-effort: sendNpsSurvey() already no-ops on its own
    // (disabled / already sent today) and a failure here must not
    // fail the close itself.
    sendNpsSurvey({
      accountId,
      userId,
      conversationId: updated.conversation_id,
      triggerType: "manual_close",
    }).catch((err) => console.error("[tickets/close] nps auto-send failed:", err));

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
