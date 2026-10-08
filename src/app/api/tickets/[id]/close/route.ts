import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  closeTicket,
  closeTicketWithoutReason,
  TicketClosedError,
  TicketNotFoundError,
} from "@/lib/tickets/lifecycle";
import { sendNpsSurvey } from "@/lib/nps/send-survey";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/tickets/[id]/close
 *
 * Fase 1 (atendimento), Etapa 6 — the close dialog. `closingReasonId`
 * is OPTIONAL: an agent can close in one click without picking a
 * reason, in which case this falls back to closeTicketWithoutReason
 * (the seeded 'no_reason_informed' system reason) — same mechanism
 * every automated close already uses, just reached manually here.
 * `actorId` staying a real user id either way is what keeps
 * `closed_by='agent'` honest even on the no-reason path (see
 * closeTicket's doc comment).
 *
 * When a reason IS given, it's still validated exactly as before:
 * `closeTicket` itself only checks the reason belongs to the ticket's
 * account — it does NOT reject `is_system` reasons
 * (closeTicketWithoutReason legitimately passes one internally). So
 * THIS route is what guarantees an agent can never manually hand-pick
 * a system reason id: it rejects `is_system` explicitly before ever
 * calling closeTicket. That check only applies to the with-reason
 * path — the no-reason path goes through closeTicketWithoutReason
 * directly, which is the ONLY legitimate way a system reason gets used.
 *
 * Body: { closingReasonId?: string, note?: string }
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, accountId, userId } = await requireRole("agent");

    const body = await request.json();
    const closingReasonId = body.closingReasonId as string | undefined;
    const note = (body.note as string | undefined)?.trim() || undefined;

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select("id, conversation_id")
      .eq("id", id)
      .maybeSingle();
    if (ticketError) {
      console.error("[POST /api/tickets/[id]/close] ticket load error:", ticketError);
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    let updated;
    if (closingReasonId) {
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
      updated = await closeTicket(id, closingReasonId, userId, note);
    } else {
      updated = await closeTicketWithoutReason(ticket.conversation_id, userId, note);
      if (!updated) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
    }

    // Mirrors the automations/flows close_conversation step (engine.ts)
    // — fires for both the with-reason and no-reason paths alike.
    // Best-effort: sendNpsSurvey() already no-ops on its own (disabled
    // / already sent today) and a failure here must not fail the close.
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
