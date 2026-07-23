import { describe, it, expect, beforeEach, vi } from "vitest";

// Mirrors the mock shape in src/lib/automations/engine.test.ts — a tiny
// stateful fake of the service-role client, tuned to the tables this
// engine touches. Lives in a hoisted block so vi.mock's factory can
// close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    flows: [] as Record<string, unknown>[],
    nodes: [] as Record<string, unknown>[],
    insertedRun: null as Record<string, unknown> | null,
    runRow: null as Record<string, unknown> | null,
    events: [] as Record<string, unknown>[],
    pendingInserts: [] as Record<string, unknown>[],
    updateCalls: [] as { table: string; payload: unknown; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    fromCalls: [] as string[],
    runIdCounter: 0,
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type, payload } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, payload, filters: ops.filters });
        return { data: null, error: null };
      }
      return { data: state.owned, error: null };
    }
    if (table === "flows") {
      // loadFlow (start_flow) does a maybeSingle scoped by id — return
      // whichever fixture flow matches, else the raw list for the
      // dispatch-time SELECT.
      if (type === "select" && ops.filters.some(([, k]) => k === "id")) {
        const idFilter = ops.filters.find(([, k]) => k === "id");
        const found = state.flows.find((f) => f.id === idFilter?.[2]);
        return { data: found ?? null, error: null };
      }
      return { data: state.flows, error: null };
    }
    if (table === "flow_nodes") {
      return { data: state.nodes, error: null };
    }
    if (table === "flow_runs") {
      if (type === "insert") {
        state.runIdCounter += 1;
        const row = { id: `run-${state.runIdCounter}`, ...(payload as Record<string, unknown>) };
        state.insertedRun = row;
        state.runRow = row;
        return { data: row, error: null };
      }
      if (type === "update") {
        state.updateCalls.push({ table, payload, filters: ops.filters });
        if (state.runRow) state.runRow = { ...state.runRow, ...(payload as Record<string, unknown>) };
        return { data: [{ id: state.runRow?.id }], error: null };
      }
      return { data: state.runRow, error: null };
    }
    if (table === "flow_run_events") {
      if (type === "insert") {
        state.events.push(payload as Record<string, unknown>);
      }
      return { data: null, error: null };
    }
    if (table === "flow_pending_executions") {
      if (type === "insert") {
        state.pendingInserts.push(payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (type === "update") {
        state.updateCalls.push({ table, payload, filters: ops.filters });
      }
      return { data: null, error: null };
    }
    if (table === "custom_fields") {
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload });
      }
      return { data: null, error: null };
    }
    if (table === "contact_tags") {
      if (type === "upsert" || type === "delete") return { data: null, error: null };
      return { data: null, error: null, count: 0 };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      neq: () => b,
      in: () => b,
      gte: () => b,
      lte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

vi.mock("@/lib/nps/send-survey", () => ({
  sendNpsSurvey: vi.fn(async () => ({ sent: true })),
}));

import { runFlowsForTrigger } from "./workflow-engine";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.flows = [];
  h.state.nodes = [];
  h.state.insertedRun = null;
  h.state.runRow = null;
  h.state.events = [];
  h.state.pendingInserts = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.fromCalls = [];
  h.state.runIdCounter = 0;
});

function workflowFlow(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    account_id: ACCOUNT,
    user_id: "u1",
    name: "test flow",
    trigger_type: "new_contact_created",
    trigger_config: {},
    run_mode: "workflow",
    status: "active",
    entry_node_id: "start",
    fallback_policy: {},
    ...overrides,
  };
}

function endedWithStatus(status: string): boolean {
  return h.state.updateCalls.some(
    (c) => c.table === "flow_runs" && (c.payload as Record<string, unknown>).status === status,
  );
}

describe("runFlowsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account", async () => {
    h.state.owned = null;
    h.state.flows = [workflowFlow()];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_contact_created",
      contactId: "victim-contact-uuid",
      context: {},
    });

    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("flows");
    expect(h.state.insertedRun).toBeNull();
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = []; // no matching flows; just prove we got past the guard

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_contact_created",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("flows");
  });
});

describe("runFlowsForTrigger — trigger matching", () => {
  const nodes = [
    { node_key: "start", node_type: "start", config: { next_node_key: "e" } },
    { node_key: "e", node_type: "end", config: {} },
  ];

  it("does not start a run when a keyword_match trigger doesn't match", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = [
      workflowFlow({
        trigger_type: "keyword_match",
        trigger_config: { keywords: ["cancelar"], match_type: "contains" },
      }),
    ];
    h.state.nodes = nodes;

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "keyword_match",
      contactId: "c1",
      context: { message_text: "oi tudo bem" },
    });

    expect(h.state.insertedRun).toBeNull();
  });

  it("starts a run when a keyword_match trigger matches", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = [
      workflowFlow({
        trigger_type: "keyword_match",
        trigger_config: { keywords: ["cancelar"], match_type: "contains" },
      }),
    ];
    h.state.nodes = nodes;

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "keyword_match",
      contactId: "c1",
      context: { message_text: "quero cancelar minha conta" },
    });

    expect(h.state.insertedRun).not.toBeNull();
  });
});

describe("update_contact_field — custom fields (mirrors automations' engine.test.ts coverage)", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.flows = [workflowFlow()];
    h.state.nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "ucf" } },
      {
        node_key: "ucf",
        node_type: "update_contact_field",
        config: { field: "custom:cf1", value: "Premium", next_node_key: "end" },
      },
      { node_key: "end", node_type: "end", config: {} },
    ];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_contact_created",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
    expect(endedWithStatus("completed")).toBe(true);
  });

  it("refuses to write a custom field from another account and fails the run", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.flows = [workflowFlow()];
    h.state.nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "ucf" } },
      {
        node_key: "ucf",
        node_type: "update_contact_field",
        config: { field: "custom:foreign-cf", value: "x", next_node_key: "end" },
      },
      { node_key: "end", node_type: "end", config: {} },
    ];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_contact_created",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(endedWithStatus("failed")).toBe(true);
  });
});

describe("wait node", () => {
  it("suspends via flow_pending_executions instead of ending the run", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = [workflowFlow({ trigger_type: "deal_won" })];
    h.state.nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "w" } },
      { node_key: "w", node_type: "wait", config: { amount: 5, unit: "minutes", next_node_key: "end" } },
      { node_key: "end", node_type: "end", config: {} },
    ];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "deal_won",
      contactId: "c1",
      context: {},
    });

    expect(h.state.pendingInserts).toHaveLength(1);
    expect(h.state.pendingInserts[0]).toMatchObject({
      flow_id: "f1",
      resume_node_key: "end",
      status: "pending",
    });
    // Parked, not ended — no terminal status write on flow_runs.
    expect(endedWithStatus("completed")).toBe(false);
    expect(endedWithStatus("failed")).toBe(false);
  });
});

describe("condition node — var subject", () => {
  it("branches on flow_runs.vars set from the trigger context", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = [workflowFlow({ trigger_type: "deal_won" })];
    h.state.nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "c" } },
      {
        node_key: "c",
        node_type: "condition",
        config: {
          subject: "var",
          subject_key: "score",
          operator: "equals",
          value: "10",
          true_next: "t",
          false_next: "f",
        },
      },
      { node_key: "t", node_type: "end", config: {} },
      { node_key: "f", node_type: "end", config: {} },
    ];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "deal_won",
      contactId: "c1",
      context: { vars: { score: "10" } },
    });

    expect(
      h.state.events.some((e) => e.event_type === "completed" && e.node_key === "t"),
    ).toBe(true);
  });
});

describe("stop_flow", () => {
  it("ends the run as completed with a distinct end_reason", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = [workflowFlow({ trigger_type: "deal_won" })];
    h.state.nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "s" } },
      { node_key: "s", node_type: "stop_flow", config: {} },
    ];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "deal_won",
      contactId: "c1",
      context: {},
    });

    const stopUpdate = h.state.updateCalls.find(
      (c) =>
        c.table === "flow_runs" &&
        (c.payload as Record<string, unknown>).end_reason === "stop_flow_node",
    );
    expect(stopUpdate).toBeDefined();
    expect((stopUpdate?.payload as Record<string, unknown>).status).toBe("completed");
  });
});

describe("customer-reply node types are unsupported in workflow mode", () => {
  it("fails the run rather than hanging on a send_buttons node", async () => {
    h.state.owned = { id: "c1" };
    h.state.flows = [workflowFlow({ trigger_type: "deal_won" })];
    h.state.nodes = [
      { node_key: "start", node_type: "start", config: { next_node_key: "sb" } },
      { node_key: "sb", node_type: "send_buttons", config: { text: "hi", buttons: [] } },
    ];

    await runFlowsForTrigger({
      accountId: ACCOUNT,
      triggerType: "deal_won",
      contactId: "c1",
      context: {},
    });

    expect(
      h.state.events.some(
        (e) => e.event_type === "error" && (e.payload as Record<string, unknown>)?.reason === "unsupported_in_workflow_mode",
      ),
    ).toBe(true);
    expect(endedWithStatus("failed")).toBe(true);
  });
});
