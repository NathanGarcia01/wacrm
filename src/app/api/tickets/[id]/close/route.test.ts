import { describe, expect, it, vi } from "vitest";

// Fase 1 Etapa 6's mandatory-reason close dialog never got the NPS
// auto-send that the automations/flows close_conversation step and the
// old manual-close UI both have — this test exists specifically to
// prove that gap is closed, without ever touching engineSendText /
// Meta's API (sendNpsSurvey itself is mocked, never called for real).

const requireRoleMock = vi.fn();
vi.mock("@/lib/auth/account", () => ({
  requireRole: requireRoleMock,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}));

const closeTicketMock = vi.fn();
vi.mock("@/lib/tickets/lifecycle", () => ({
  closeTicket: closeTicketMock,
  TicketClosedError: class TicketClosedError extends Error {},
  TicketNotFoundError: class TicketNotFoundError extends Error {},
}));

const sendNpsSurveyMock = vi.fn();
vi.mock("@/lib/nps/send-survey", () => ({
  sendNpsSurvey: sendNpsSurveyMock,
}));

const supabaseStub = {
  from: (table: string) => {
    if (table === "tickets") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: "ticket-1" }, error: null }),
          }),
        }),
      };
    }
    if (table === "closing_reasons") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "reason-1", is_system: false }, error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  },
};

describe("POST /api/tickets/[id]/close — NPS auto-send", () => {
  it("fires sendNpsSurvey with the closed ticket's conversationId after a successful close", async () => {
    requireRoleMock.mockResolvedValue({
      supabase: supabaseStub,
      accountId: "account-1",
      userId: "user-1",
    });
    closeTicketMock.mockResolvedValue({
      id: "ticket-1",
      conversation_id: "conversation-1",
      account_id: "account-1",
      status: "closed",
    });
    sendNpsSurveyMock.mockResolvedValue({ sent: true });

    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/tickets/ticket-1/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ closingReasonId: "reason-1" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "ticket-1" }) });
    expect(response.status).toBe(200);

    expect(closeTicketMock).toHaveBeenCalledWith("ticket-1", "reason-1", "user-1", undefined);

    // sendNpsSurvey is fire-and-forget (no await before the response is
    // built) — flush microtasks once before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendNpsSurveyMock).toHaveBeenCalledWith({
      accountId: "account-1",
      userId: "user-1",
      conversationId: "conversation-1",
      triggerType: "manual_close",
    });
  });

  it("never sends a real message — sendNpsSurvey is mocked, not the real implementation", async () => {
    // Guards against someone accidentally un-mocking @/lib/nps/send-survey
    // above and silently restoring a real-send path to this test.
    const mod = await import("@/lib/nps/send-survey");
    expect(vi.isMockFunction(mod.sendNpsSurvey)).toBe(true);
  });
});
