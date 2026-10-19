import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for `start_flow` ("Iniciar outro fluxo") in the
 * CONVERSATIONAL engine (migration 114) — covers the three scenarios
 * the bug report asked for:
 *   1. encadeamento simples — a chain of flows starting each other
 *      within the allowed limit.
 *   2. tentativa de loop — direct self-reference, and the 5-in-a-row
 *      chain-limit guard tripping on a long chain.
 *   3. destino inativo — target flow not active / not found / wrong
 *      run_mode.
 *
 * Same fake-Supabase-query-builder approach as reply-timeout.test.ts
 * (self-contained copy — the two files don't share test
 * infrastructure, matching this project's per-file test convention).
 */

type Row = Record<string, unknown>;

function makeFakeDb(tables: Record<string, Row[]>) {
  function builder(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let updatePatch: Row | null = null;
    let insertRows: Row[] | null = null;
    const filters: Array<(row: Row) => boolean> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    let wantMaybeSingle = false;

    const self = {
      select() {
        return self;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return self;
      },
      neq(col: string, val: unknown) {
        filters.push((row) => row[col] !== val);
        return self;
      },
      is(col: string) {
        filters.push((row) => row[col] === null || row[col] === undefined);
        return self;
      },
      in(col: string, vals: unknown[]) {
        filters.push((row) => vals.includes(row[col]));
        return self;
      },
      filter() {
        filters.push(() => false);
        return self;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return self;
      },
      limit(n: number) {
        limitN = n;
        return self;
      },
      maybeSingle() {
        wantMaybeSingle = true;
        return self;
      },
      update(patch: Row) {
        op = "update";
        updatePatch = patch;
        return self;
      },
      insert(rows: Row | Row[]) {
        op = "insert";
        insertRows = Array.isArray(rows) ? rows : [rows];
        return self;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          resolve(execute());
        } catch (e) {
          reject?.(e);
        }
      },
    };

    function execute(): { data: unknown; error: null } {
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "insert") {
        const inserted = (insertRows ?? []).map((r) => ({
          id: (r.id as string) ?? `id_${Math.random().toString(36).slice(2)}`,
          status: "active",
          vars: {},
          reprompt_count: 0,
          started_at: new Date().toISOString(),
          last_advanced_at: new Date().toISOString(),
          ended_at: null,
          end_reason: null,
          ...r,
        }));
        rows.push(...inserted);
        return { data: wantMaybeSingle ? inserted[0] ?? null : inserted, error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const row of matched) Object.assign(row, updatePatch);
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }
      if (orderCol) {
        const col = orderCol;
        matched = [...matched].sort((a, b) => {
          const av = a[col] as string;
          const bv = b[col] as string;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderAsc ? cmp : -cmp;
        });
      }
      if (limitN !== null) matched = matched.slice(0, limitN);
      if (wantMaybeSingle) return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    }

    return self;
  }

  return {
    from: builder,
    rpc: async () => ({ data: null, error: null }),
  };
}

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof makeFakeDb> | null }));

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => state.db,
}));

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
}));

const { startManualRun } = await import("./engine");

function flowRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    account_id: "acct-1",
    user_id: "user-1",
    name: `Flow ${id}`,
    status: "active",
    run_mode: "conversational",
    trigger_type: "manual",
    trigger_config: {},
    entry_node_id: null,
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    execution_count: 0,
    ...overrides,
  };
}

function startFlowNode(
  flowId: string,
  nodeKey: string,
  targetFlowId: string,
): Row {
  return {
    id: `n_${nodeKey}`,
    flow_id: flowId,
    node_key: nodeKey,
    node_type: "start_flow",
    config: { flow_id: targetFlowId, next_node_key: "unused" },
    position_x: 0,
    position_y: 0,
  };
}

function endNode(flowId: string, nodeKey: string): Row {
  return {
    id: `n_${nodeKey}`,
    flow_id: flowId,
    node_key: nodeKey,
    node_type: "end",
    config: {},
    position_x: 0,
    position_y: 0,
  };
}

function freshTables(): Record<string, Row[]> {
  return { flows: [], flow_nodes: [], flow_runs: [], flow_run_events: [] };
}

beforeEach(() => {
  state.db = null;
});

describe("start_flow — encadeamento simples + limite de encadeamento (item 1 e 2)", () => {
  it("chains 5 flows successfully, then blocks the 6th hop and logs the reason", async () => {
    const tables = freshTables();
    // flow-0 --sf--> flow-1 --sf--> ... --sf--> flow-5 --sf--> flow-6 (never created)
    for (let i = 0; i <= 5; i++) {
      tables.flows.push(flowRow(`flow-${i}`, { entry_node_id: `s${i}` }));
      tables.flow_nodes.push(startFlowNode(`flow-${i}`, `s${i}`, `flow-${i + 1}`));
    }
    state.db = makeFakeDb(tables);

    const result = await startManualRun("flow-0", "contact-1", "conv-1");
    expect(result.ok).toBe(true);

    // 6 runs created (flow-0..flow-5) — flow-6 never gets one, the
    // chain limit trips before startChainedRun is even attempted for it.
    expect(tables.flow_runs).toHaveLength(6);
    expect(tables.flow_runs.some((r) => r.flow_id === "flow-6")).toBe(false);

    for (let i = 0; i <= 4; i++) {
      const run = tables.flow_runs.find((r) => r.flow_id === `flow-${i}`)!;
      expect(run.status).toBe("completed");
      expect(run.end_reason).toBe("start_flow");
    }

    const blockedRun = tables.flow_runs.find((r) => r.flow_id === "flow-5")!;
    expect(blockedRun.status).toBe("failed");
    expect(blockedRun.end_reason).toBe("start_flow_chain_limit_reached");

    const blockedEvents = tables.flow_run_events.filter(
      (e) => e.flow_run_id === blockedRun.id,
    );
    expect(
      blockedEvents.some(
        (e) =>
          e.event_type === "error" &&
          (e.payload as Row).reason === "start_flow_chain_limit_reached",
      ),
    ).toBe(true);

    // vars.__flow_chain__ grows by one entry per hop — flow-0's run is
    // the original manual start (no chain yet); each chained run
    // inherits + extends it.
    const run0 = tables.flow_runs.find((r) => r.flow_id === "flow-0")!;
    expect((run0.vars as Row).__flow_chain__).toBeUndefined();
    const run4 = tables.flow_runs.find((r) => r.flow_id === "flow-4")!;
    expect((run4.vars as Row).__flow_chain__ as unknown[]).toHaveLength(4);
    const run5Chain = (blockedRun.vars as Row).__flow_chain__ as unknown[];
    expect(run5Chain).toHaveLength(5);
  });

  it("a short chain (2 flows) completes cleanly with no guard firing", async () => {
    const tables = freshTables();
    tables.flows.push(flowRow("flow-a", { entry_node_id: "sa" }));
    tables.flow_nodes.push(startFlowNode("flow-a", "sa", "flow-b"));
    tables.flows.push(flowRow("flow-b", { entry_node_id: "eb" }));
    tables.flow_nodes.push(endNode("flow-b", "eb"));
    state.db = makeFakeDb(tables);

    const result = await startManualRun("flow-a", "contact-2", "conv-2");
    expect(result.ok).toBe(true);

    expect(tables.flow_runs).toHaveLength(2);
    const runA = tables.flow_runs.find((r) => r.flow_id === "flow-a")!;
    const runB = tables.flow_runs.find((r) => r.flow_id === "flow-b")!;
    expect(runA.status).toBe("completed");
    expect(runA.end_reason).toBe("start_flow");
    expect(runB.status).toBe("completed");
    expect(runB.end_reason).toBe("end_node");
    expect(runB.contact_id).toBe("contact-2");
    expect(runB.conversation_id).toBe("conv-2");
  });
});

describe("start_flow — auto-referência (item 2)", () => {
  it("blocks a flow from starting itself and logs the reason, without creating a second run", async () => {
    const tables = freshTables();
    tables.flows.push(flowRow("flow-self", { entry_node_id: "sf" }));
    tables.flow_nodes.push(startFlowNode("flow-self", "sf", "flow-self"));
    state.db = makeFakeDb(tables);

    const result = await startManualRun("flow-self", "contact-3", "conv-3");
    expect(result.ok).toBe(true);

    expect(tables.flow_runs).toHaveLength(1);
    const run = tables.flow_runs[0];
    expect(run.status).toBe("failed");
    expect(run.end_reason).toBe("start_flow_self_reference");

    const events = tables.flow_run_events.filter((e) => e.flow_run_id === run.id);
    expect(
      events.some(
        (e) =>
          e.event_type === "error" &&
          (e.payload as Row).reason === "start_flow_self_reference",
      ),
    ).toBe(true);
  });
});

describe("start_flow — fluxo de destino indisponível (item 3)", () => {
  it("blocks when the target flow is not active", async () => {
    const tables = freshTables();
    tables.flows.push(flowRow("flow-x", { entry_node_id: "sx" }));
    tables.flow_nodes.push(startFlowNode("flow-x", "sx", "flow-draft"));
    tables.flows.push(flowRow("flow-draft", { status: "draft" }));
    state.db = makeFakeDb(tables);

    const result = await startManualRun("flow-x", "contact-4", "conv-4");
    expect(result.ok).toBe(true);

    expect(tables.flow_runs).toHaveLength(1);
    const run = tables.flow_runs[0];
    expect(run.status).toBe("failed");
    expect(run.end_reason).toBe("start_flow_target_unavailable");
  });

  it("blocks when the target flow doesn't exist", async () => {
    const tables = freshTables();
    tables.flows.push(flowRow("flow-y", { entry_node_id: "sy" }));
    tables.flow_nodes.push(startFlowNode("flow-y", "sy", "flow-ghost"));
    state.db = makeFakeDb(tables);

    const result = await startManualRun("flow-y", "contact-5", "conv-5");
    expect(result.ok).toBe(true);

    const run = tables.flow_runs[0];
    expect(run.status).toBe("failed");
    expect(run.end_reason).toBe("start_flow_target_unavailable");
  });

  it("blocks when the target flow is active but workflow-mode (conversational can only chain to conversational)", async () => {
    const tables = freshTables();
    tables.flows.push(flowRow("flow-z", { entry_node_id: "sz" }));
    tables.flow_nodes.push(startFlowNode("flow-z", "sz", "flow-workflow"));
    tables.flows.push(flowRow("flow-workflow", { run_mode: "workflow" }));
    state.db = makeFakeDb(tables);

    const result = await startManualRun("flow-z", "contact-6", "conv-6");
    expect(result.ok).toBe(true);

    const run = tables.flow_runs.find((r) => r.flow_id === "flow-z")!;
    expect(run.status).toBe("failed");
    expect(run.end_reason).toBe("start_flow_target_unavailable");
    // No run should have been created for the workflow-mode flow.
    expect(tables.flow_runs.some((r) => r.flow_id === "flow-workflow")).toBe(false);
  });
});
