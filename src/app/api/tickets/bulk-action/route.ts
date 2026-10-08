import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  assignTicket,
  closeTicket,
  closeTicketWithoutReason,
  returnToQueue,
  transferTicket,
  TicketClosedError,
  TicketNotFoundError,
} from "@/lib/tickets/lifecycle";
import { sendNpsSurvey } from "@/lib/nps/send-survey";
import type { Ticket } from "@/types";

const MAX_BATCH = 200;

type BulkAction = "mark_read" | "mark_unread" | "assign" | "transfer" | "return_to_queue" | "close";
const VALID_ACTIONS: BulkAction[] = ["mark_read", "mark_unread", "assign", "transfer", "return_to_queue", "close"];

interface ResultRow {
  conversationId: string;
  status: "success" | "skipped" | "failed";
  reason?: string;
}

/**
 * POST /api/tickets/bulk-action
 *
 * Fase 1 (atendimento) — ação em massa unificada, usada pela inbox
 * NOVA (tickets_ui_enabled=true) e pela ANTIGA — a antiga só troca o
 * que os botões da barra de seleção chamam, nada na UI dela muda.
 * Isso fecha o gap conhecido: bulk-assign/bulk-close antes escreviam
 * direto em `conversations` sem nunca passar pelo ticket (sem
 * ticket_events, sem exigir motivo) — agora tudo passa por
 * src/lib/tickets/lifecycle.ts, igual às ações individuais.
 *
 * O cliente nunca manda milhares de ids numa chamada só — no máximo
 * MAX_BATCH por request; lotes maiores são responsabilidade do
 * cliente (src/lib/inbox/bulk-action-client.ts), que despacha várias
 * chamadas e agrega o resumo.
 *
 * `mark_read`/`mark_unread` não têm conceito de ticket — sempre
 * sucesso pra qualquer conversa válida da conta. As outras quatro
 * (assign/transfer/return_to_queue/close) exigem um ticket ABERTO;
 * conversa sem ticket aberto (nunca teve, ou o último está fechado)
 * entra no resultado como "skipped" / "no_open_ticket" — nunca como
 * erro, e `mark_read`/`mark_unread` continuam valendo pra ela.
 *
 * `close` sem `payload.closingReasonId`: usa closeTicketWithoutReason
 * (motivo de sistema 'no_reason_informed') — é o caminho da inbox
 * ANTIGA, que não tem modal de motivo. Com `closingReasonId`: exige
 * um motivo real (valida que não é is_system, mesma regra de
 * /api/tickets/[id]/close) — é o caminho da inbox NOVA.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");

    const body = await request.json();
    const action = body.action as BulkAction;
    const conversationIds = body.conversationIds as unknown;
    const payload = (body.payload ?? {}) as Record<string, unknown>;

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return NextResponse.json({ error: "conversationIds is required" }, { status: 400 });
    }
    if (conversationIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Max ${MAX_BATCH} conversations per request` },
        { status: 400 },
      );
    }

    // Validate the closing reason ONCE for the whole batch, not once
    // per conversation — same reason applies to all of them.
    let closingReasonId: string | undefined;
    if (action === "close" && payload.closingReasonId) {
      const { data: reason, error: reasonError } = await supabase
        .from("closing_reasons")
        .select("id, is_system")
        .eq("id", payload.closingReasonId as string)
        .eq("account_id", accountId)
        .maybeSingle();
      if (reasonError) {
        console.error("[POST /api/tickets/bulk-action] reason load error:", reasonError);
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
      closingReasonId = reason.id;
    }

    // RLS already scopes this to the caller's account — ids that
    // don't come back here are either someone else's or don't exist;
    // either way they fail as "not_found" below, never a 500.
    const { data: convRows, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .in("id", conversationIds as string[]);
    if (convError) {
      console.error("[POST /api/tickets/bulk-action] conversations load error:", convError);
      return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
    }
    const validIds = new Set((convRows ?? []).map((c) => c.id as string));

    const results: ResultRow[] = [];

    if (action === "mark_read" || action === "mark_unread") {
      const unreadCount = action === "mark_read" ? 0 : 1;
      for (const conversationId of conversationIds as string[]) {
        if (!validIds.has(conversationId)) {
          results.push({ conversationId, status: "failed", reason: "not_found" });
          continue;
        }
        const { error } = await supabase
          .from("conversations")
          .update({ unread_count: unreadCount })
          .eq("id", conversationId);
        results.push(
          error
            ? { conversationId, status: "failed", reason: error.message }
            : { conversationId, status: "success" },
        );
      }
      return NextResponse.json({ results });
    }

    // One bulk query for every requested conversation's currently
    // open ticket, instead of N round trips (findOpenTicket per id).
    const { data: openTickets, error: ticketsError } = await supabase
      .from("tickets")
      .select("*")
      .in("conversation_id", conversationIds as string[])
      .neq("status", "closed");
    if (ticketsError) {
      console.error("[POST /api/tickets/bulk-action] tickets load error:", ticketsError);
      return NextResponse.json({ error: "Failed to load tickets" }, { status: 500 });
    }
    const openTicketByConversation = new Map<string, Ticket>(
      ((openTickets ?? []) as Ticket[]).map((t) => [t.conversation_id, t]),
    );

    for (const conversationId of conversationIds as string[]) {
      if (!validIds.has(conversationId)) {
        results.push({ conversationId, status: "failed", reason: "not_found" });
        continue;
      }
      const ticket = openTicketByConversation.get(conversationId);
      if (!ticket) {
        results.push({ conversationId, status: "skipped", reason: "no_open_ticket" });
        continue;
      }
      try {
        switch (action) {
          case "assign": {
            const agentId = payload.agentId as string | undefined;
            if (!agentId) throw new Error("agentId is required");
            await assignTicket(ticket.id, agentId, userId);
            break;
          }
          case "transfer": {
            const target: { toAgentId?: string | null; toDepartmentId?: string | null } = {};
            if (Object.prototype.hasOwnProperty.call(payload, "agentId")) {
              target.toAgentId = payload.agentId as string | null;
            }
            if (Object.prototype.hasOwnProperty.call(payload, "departmentId")) {
              target.toDepartmentId = payload.departmentId as string | null;
            }
            await transferTicket(ticket.id, target, userId);
            break;
          }
          case "return_to_queue":
            await returnToQueue(ticket.id, userId);
            break;
          case "close":
            if (closingReasonId) {
              await closeTicket(ticket.id, closingReasonId, userId, payload.note as string | undefined);
            } else {
              await closeTicketWithoutReason(conversationId, userId);
            }
            // Same gap as the single-ticket close route — bulk close
            // never got the NPS auto-send either. Best-effort,
            // per-conversation; one failure here must not fail the
            // close or the rest of the batch.
            sendNpsSurvey({
              accountId,
              userId,
              conversationId,
              triggerType: "manual_close",
            }).catch((err) => console.error("[tickets/bulk-action] nps auto-send failed:", err));
            break;
        }
        results.push({ conversationId, status: "success" });
      } catch (err) {
        const reason =
          err instanceof TicketClosedError || err instanceof TicketNotFoundError
            ? err.message
            : err instanceof Error
              ? err.message
              : "unknown_error";
        results.push({ conversationId, status: "failed", reason });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return toErrorResponse(err);
  }
}
