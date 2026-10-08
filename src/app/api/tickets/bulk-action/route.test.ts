import { describe, expect, it, vi } from "vitest";

// Same gap as the single-ticket close route (./[id]/close/route.test.ts)
// — bulk close never sent NPS either. sendNpsSurvey is mocked here too,
// so this never touches engineSendText / Meta's API.

const requireRoleMock = vi.fn();
vi.mock("@/lib/auth/account", () => ({
  requireRole: requireRoleMock,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}));

const assignTicketMock = vi.fn();
const closeTicketMock = vi.fn();
const closeTicketWithoutReasonMock = vi.fn();
const returnToQueueMock = vi.fn();
const transferTicketMock = vi.fn();
vi.mock("@/lib/tickets/lifecycle", () => ({
  assignTicket: assignTicketMock,
  closeTicket: closeTicketMock,
  closeTicketWithoutReason: closeTicketWithoutReasonMock,
  returnToQueue: returnToQueueMock,
  transferTicket: transferTicketMock,
  TicketClosedError: class TicketClosedError extends Error {},
  TicketNotFoundError: class TicketNotFoundError extends Error {},
}));

const sendNpsSurveyMock = vi.fn();
vi.mock("@/lib/nps/send-survey", () => ({
  sendNpsSurvey: sendNpsSurveyMock,
}));

function supabaseStub(openTickets: { id: string; conversation_id: string }[]) {
  return {
    from: (table: string) => {
      if (table === "conversations") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({ data: ids.map((id) => ({ id })), error: null }),
          }),
        };
      }
      if (table === "tickets") {
        return {
          select: () => ({
            in: () => ({
              neq: () => Promise.resolve({ data: openTickets, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("POST /api/tickets/bulk-action — NPS auto-send on close", () => {
  it("fires sendNpsSurvey per conversation after a successful closeTicketWithoutReason (no reason payload)", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: supabaseStub([{ id: "ticket-1", conversation_id: "conversation-1" }]),
      accountId: "account-1",
      userId: "user-1",
    });
    closeTicketWithoutReasonMock.mockResolvedValue({ id: "ticket-1", status: "closed" });
    sendNpsSurveyMock.mockResolvedValue({ sent: true });

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/tickets/bulk-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close", conversationIds: ["conversation-1"] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([{ conversationId: "conversation-1", status: "success" }]);

    expect(closeTicketWithoutReasonMock).toHaveBeenCalledWith("conversation-1", "user-1");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendNpsSurveyMock).toHaveBeenCalledWith({
      accountId: "account-1",
      userId: "user-1",
      conversationId: "conversation-1",
      triggerType: "manual_close",
    });
  });

  it("does not fire sendNpsSurvey for a conversation with no open ticket (skipped)", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: supabaseStub([]), // no open tickets at all
      accountId: "account-1",
      userId: "user-1",
    });
    sendNpsSurveyMock.mockClear();

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/tickets/bulk-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close", conversationIds: ["conversation-2"] }),
    });

    const response = await POST(request);
    const body = await response.json();
    expect(body.results).toEqual([
      { conversationId: "conversation-2", status: "skipped", reason: "no_open_ticket" },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendNpsSurveyMock).not.toHaveBeenCalled();
  });
});
