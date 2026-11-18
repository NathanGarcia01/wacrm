import { describe, expect, it } from "vitest";

import { decideAssignment, isEligibleCandidate, type RoutingCandidate, type RoutingTicketInput } from "./decide";

const TICKET: RoutingTicketInput = { id: "ticket-1", departmentId: null };

function candidate(overrides: Partial<RoutingCandidate> = {}): RoutingCandidate {
  return {
    userId: "agent-1",
    role: "agent",
    departmentIds: [],
    presenceStatus: "online",
    isEnabled: true,
    capacity: 5,
    inProgressCount: 0,
    lastAssignedAt: null,
    ...overrides,
  };
}

describe("isEligibleCandidate", () => {
  it("excludes viewers even if online and under capacity", () => {
    expect(isEligibleCandidate(TICKET, candidate({ role: "viewer" }))).toBe(false);
  });

  it("excludes offline but includes online and away", () => {
    expect(isEligibleCandidate(TICKET, candidate({ presenceStatus: "offline" }))).toBe(false);
    expect(isEligibleCandidate(TICKET, candidate({ presenceStatus: "online" }))).toBe(true);
    expect(isEligibleCandidate(TICKET, candidate({ presenceStatus: "away" }))).toBe(true);
  });

  it("excludes a candidate outside the ticket's department", () => {
    const ticket: RoutingTicketInput = { id: "t", departmentId: "dept-1" };
    expect(isEligibleCandidate(ticket, candidate({ departmentIds: ["dept-2"] }))).toBe(false);
    expect(isEligibleCandidate(ticket, candidate({ departmentIds: ["dept-1"] }))).toBe(true);
  });

  it("does not restrict by department when the ticket has none", () => {
    expect(isEligibleCandidate(TICKET, candidate({ departmentIds: ["dept-1"] }))).toBe(true);
    expect(isEligibleCandidate(TICKET, candidate({ departmentIds: [] }))).toBe(true);
  });

  it("excludes a disabled (opted-out) member", () => {
    expect(isEligibleCandidate(TICKET, candidate({ isEnabled: false }))).toBe(false);
  });

  it("excludes a candidate at or above capacity", () => {
    expect(isEligibleCandidate(TICKET, candidate({ capacity: 3, inProgressCount: 3 }))).toBe(false);
    expect(isEligibleCandidate(TICKET, candidate({ capacity: 3, inProgressCount: 2 }))).toBe(true);
  });
});

describe("decideAssignment", () => {
  it("returns null when there is no eligible candidate", () => {
    const result = decideAssignment(
      TICKET,
      [candidate({ role: "viewer" }), candidate({ userId: "agent-2", presenceStatus: "offline" })],
      "round_robin",
    );
    expect(result).toBeNull();
  });

  it("round_robin: a candidate who never received one beats anyone with a timestamp", () => {
    const result = decideAssignment(
      TICKET,
      [
        candidate({ userId: "agent-busy-history", lastAssignedAt: 1000 }),
        candidate({ userId: "agent-never", lastAssignedAt: null }),
      ],
      "round_robin",
    );
    expect(result).toEqual({ agentId: "agent-never", reason: "round_robin_never_assigned" });
  });

  it("round_robin: among candidates with history, the oldest assignment wins", () => {
    const result = decideAssignment(
      TICKET,
      [
        candidate({ userId: "agent-recent", lastAssignedAt: 5000 }),
        candidate({ userId: "agent-oldest", lastAssignedAt: 1000 }),
      ],
      "round_robin",
    );
    expect(result).toEqual({ agentId: "agent-oldest", reason: "round_robin_oldest" });
  });

  it("round_robin: a tie (two candidates never assigned) resolves deterministically by userId", () => {
    const result = decideAssignment(
      TICKET,
      [
        candidate({ userId: "agent-zulu", lastAssignedAt: null }),
        candidate({ userId: "agent-alpha", lastAssignedAt: null }),
      ],
      "round_robin",
    );
    expect(result).toEqual({ agentId: "agent-alpha", reason: "round_robin_never_assigned" });

    // Order of the input array must not matter — same result reversed.
    const reversed = decideAssignment(
      TICKET,
      [
        candidate({ userId: "agent-alpha", lastAssignedAt: null }),
        candidate({ userId: "agent-zulu", lastAssignedAt: null }),
      ],
      "round_robin",
    );
    expect(reversed).toEqual({ agentId: "agent-alpha", reason: "round_robin_never_assigned" });
  });

  it("load: the candidate with the fewest in_progress tickets wins", () => {
    const result = decideAssignment(
      TICKET,
      [
        candidate({ userId: "agent-busy", inProgressCount: 4 }),
        candidate({ userId: "agent-free", inProgressCount: 1 }),
      ],
      "load",
    );
    expect(result).toEqual({ agentId: "agent-free", reason: "load_least_busy" });
  });

  it("load: a tie in load falls back to the round_robin criterion", () => {
    const result = decideAssignment(
      TICKET,
      [
        candidate({ userId: "agent-recent", inProgressCount: 2, lastAssignedAt: 5000 }),
        candidate({ userId: "agent-never", inProgressCount: 2, lastAssignedAt: null }),
      ],
      "load",
    );
    expect(result).toEqual({ agentId: "agent-never", reason: "load_tiebreak_round_robin" });
  });

  it("a ticket with a department only considers candidates in that department", () => {
    const ticket: RoutingTicketInput = { id: "t", departmentId: "dept-support" };
    const result = decideAssignment(
      ticket,
      [
        candidate({ userId: "agent-outside", departmentIds: ["dept-sales"], lastAssignedAt: null }),
        candidate({ userId: "agent-inside", departmentIds: ["dept-support"], lastAssignedAt: 1000 }),
      ],
      "round_robin",
    );
    expect(result).toEqual({ agentId: "agent-inside", reason: "round_robin_oldest" });
  });

  it("a viewer is never chosen even as the only candidate", () => {
    const result = decideAssignment(TICKET, [candidate({ role: "viewer" })], "load");
    expect(result).toBeNull();
  });
});
