import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for the four scenarios the "tempo limite de
 * resposta" feature spec calls out explicitly:
 *   1. respondeu dentro do prazo
 *   2. prazo vencido
 *   3. resposta depois do prazo (não volta pro ramo antigo)
 *   4. conversa fechada durante a espera
 *
 * engine.ts/validate.ts's own tests stay pure-function-only (the
 * project's existing convention), but these four are inherently about
 * DB state transitions and race guards, so this file drives the real
 * exported entry points (dispatchInboundToFlows,
 * resumeWaitForReplyTimeout, cancelWaitingFlowRunsForContact) against
 * a minimal in-memory fake of the Supabase query builder — enough of
 * the chainable surface (select/eq/is/in/order/limit/update/insert/
 * maybeSingle) to exercise the real code paths, nothing Meta-related
 * ever leaves the process (engineSendText is mocked).
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
    let countMode = false;

    const self = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) countMode = true;
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
      lte(col: string, val: string) {
        filters.push((row) => {
          const v = row[col];
          return typeof v === "string" && v <= val;
        });
        return self;
      },
      filter() {
        // Only used by isDuplicateInbound's JSONB payload lookup —
        // not exercised by these scenarios; always "no match".
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

    function execute(): { data: unknown; error: null; count?: number } {
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "insert") {
        const inserted = (insertRows ?? []).map((r) => ({
          id: (r.id as string) ?? `id_${Math.random().toString(36).slice(2)}`,
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
      if (countMode) return { data: null, error: null, count: matched.length };
      if (wantMaybeSingle) return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    }

    return self;
  }

  return { from: builder };
}

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof makeFakeDb> | null }));

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => state.db,
}));

const engineSendTextMock = vi.fn(async (arg: unknown) => {
  void arg;
  return { whatsapp_message_id: "wamid.fake" };
});
vi.mock("./meta-send", () => ({
  engineSendText: (arg: unknown) => engineSendTextMock(arg),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.fake" })),
}));

const { dispatchInboundToFlows, resumeWaitForReplyTimeout, cancelWaitingFlowRunsForContact } =
  await import("./engine");

const NOW = new Date("2026-10-19T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 10 * 60_000).toISOString();
const PAST = new Date(NOW.getTime() - 10 * 60_000).toISOString();

const FLOW_ROW: Row = {
  id: "flow-1",
  account_id: "acct-1",
  user_id: "user-1",
  name: "Test flow",
  status: "active",
  run_mode: "conversational",
  trigger_type: "manual",
  trigger_config: {},
  entry_node_id: "collect",
  fallback_policy: {
    on_unknown_reply: "reprompt",
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: "handoff",
  },
};

const NODES: Row[] = [
  {
    id: "n1",
    flow_id: "flow-1",
    node_key: "collect",
    node_type: "collect_input",
    config: {
      prompt_text: "Qual seu email?",
      var_key: "email",
      next_node_key: "end_ok",
      timeout_enabled: true,
      timeout_amount: 10,
      timeout_unit: "minutes",
      timeout_node_key: "end_timeout",
    },
  },
  { id: "n2", flow_id: "flow-1", node_key: "end_ok", node_type: "end", config: {} },
  { id: "n3", flow_id: "flow-1", node_key: "end_timeout", node_type: "end", config: {} },
  {
    id: "n4",
    flow_id: "flow-1",
    node_key: "wait_node",
    node_type: "wait_for_reply",
    config: {
      timeout_enabled: true,
      amount: 5,
      unit: "minutes",
      next_node_key: "end_ok2",
      timeout_node_key: "end_timeout2",
    },
  },
  { id: "n5", flow_id: "flow-1", node_key: "end_ok2", node_type: "end", config: {} },
  { id: "n6", flow_id: "flow-1", node_key: "end_timeout2", node_type: "end", config: {} },
];

function baseRun(overrides: Row): Row {
  return {
    id: "run-x",
    flow_id: "flow-1",
    account_id: "acct-1",
    user_id: "user-1",
    contact_id: "contact-x",
    conversation_id: "conv-x",
    run_mode: "conversational",
    status: "waiting_reply",
    current_node_key: "collect",
    last_prompt_message_id: null,
    vars: {},
    reprompt_count: 0,
    started_at: NOW.toISOString(),
    last_advanced_at: NOW.toISOString(),
    ended_at: null,
    end_reason: null,
    waiting_reply_until: FUTURE,
    waiting_reply_timeout_node_key: "end_timeout",
    ...overrides,
  };
}

function freshTables(): Record<string, Row[]> {
  return {
    flows: [{ ...FLOW_ROW }],
    flow_nodes: NODES.map((n) => ({ ...n })),
    flow_runs: [],
    flow_run_events: [],
    messages: [],
  };
}

beforeEach(() => {
  engineSendTextMock.mockClear();
});

describe("tempo limite de resposta — respondeu dentro do prazo", () => {
  it("collect_input with timeout enabled: a reply before the deadline captures the var and advances normally", async () => {
    const tables = freshTables();
    tables.flow_runs.push(
      baseRun({
        id: "run-a",
        contact_id: "contact-a",
        conversation_id: "conv-a",
        current_node_key: "collect",
        waiting_reply_until: FUTURE,
        waiting_reply_timeout_node_key: "end_timeout",
      }),
    );
    state.db = makeFakeDb(tables);

    const result = await dispatchInboundToFlows({
      accountId: "acct-1",
      userId: "user-1",
      contactId: "contact-a",
      conversationId: "conv-a",
      message: { kind: "text", text: "joao@example.com", meta_message_id: "m-a1" },
      isFirstInboundMessage: false,
    });

    expect(result.consumed).toBe(true);
    expect(result.outcome).toBe("completed");

    const run = tables.flow_runs.find((r) => r.id === "run-a")!;
    expect(run.status).toBe("completed");
    expect(run.vars).toEqual({ email: "joao@example.com" });
    expect(run.waiting_reply_until).toBeNull();
    expect(run.end_reason).toBe("end_node");
  });
});

describe("tempo limite de resposta — prazo vencido", () => {
  it("wait_for_reply with an expired deadline advances down the timeout branch via the cron sweep", async () => {
    const tables = freshTables();
    tables.flow_runs.push(
      baseRun({
        id: "run-b",
        contact_id: "contact-b",
        conversation_id: "conv-b",
        current_node_key: "wait_node",
        waiting_reply_until: PAST,
        waiting_reply_timeout_node_key: "end_timeout2",
      }),
    );
    state.db = makeFakeDb(tables);

    await resumeWaitForReplyTimeout("run-b");

    const run = tables.flow_runs.find((r) => r.id === "run-b")!;
    expect(run.status).toBe("completed");
    expect(run.end_reason).toBe("end_node");
    expect(run.waiting_reply_until).toBeNull();

    const events = tables.flow_run_events.filter((e) => e.flow_run_id === "run-b");
    expect(events.some((e) => e.event_type === "timeout")).toBe(true);
  });
});

describe("tempo limite de resposta — resposta depois do prazo", () => {
  it("a reply arriving after the cron already fired the timeout does NOT resume the old branch", async () => {
    const tables = freshTables();
    tables.flow_runs.push(
      baseRun({
        id: "run-c",
        contact_id: "contact-c",
        conversation_id: "conv-c",
        current_node_key: "wait_node",
        waiting_reply_until: PAST,
        waiting_reply_timeout_node_key: "end_timeout2",
      }),
    );
    state.db = makeFakeDb(tables);

    // Cron fires first — the run reaches its natural end.
    await resumeWaitForReplyTimeout("run-c");
    expect(tables.flow_runs.find((r) => r.id === "run-c")!.status).toBe("completed");

    // The customer's reply lands afterwards. Because the run is no
    // longer active/waiting_reply, dispatchInboundToFlows doesn't find
    // it — it must NOT resurrect the dead run down next_node_key.
    const result = await dispatchInboundToFlows({
      accountId: "acct-1",
      userId: "user-1",
      contactId: "contact-c",
      conversationId: "conv-c",
      message: { kind: "text", text: "ainda quero responder", meta_message_id: "m-c1" },
      isFirstInboundMessage: false,
    });

    expect(result.consumed).toBe(false);
    expect(result.outcome).toBe("no_match");
    // The run's terminal state from the timeout branch is untouched —
    // the late reply did not flip it back or re-advance it.
    const run = tables.flow_runs.find((r) => r.id === "run-c")!;
    expect(run.status).toBe("completed");
    expect(run.end_reason).toBe("end_node");
  });
});

describe("tempo limite de resposta — conversa fechada durante a espera", () => {
  it("cancelWaitingFlowRunsForContact ends a pending wait so the cron never resumes it", async () => {
    const tables = freshTables();
    tables.flow_runs.push(
      baseRun({
        id: "run-d",
        contact_id: "contact-d",
        conversation_id: "conv-d",
        current_node_key: "collect",
        waiting_reply_until: FUTURE,
        waiting_reply_timeout_node_key: "end_timeout",
      }),
    );
    state.db = makeFakeDb(tables);

    const cancelled = await cancelWaitingFlowRunsForContact("contact-d", "conversation_closed");
    expect(cancelled).toBe(1);

    const run = tables.flow_runs.find((r) => r.id === "run-d")!;
    expect(run.status).toBe("cancelled");
    expect(run.end_reason).toBe("conversation_closed");
    expect(run.waiting_reply_until).toBeNull();
    expect(run.waiting_reply_timeout_node_key).toBeNull();
    expect(run.ended_at).not.toBeNull();

    const events = tables.flow_run_events.filter((e) => e.flow_run_id === "run-d");
    expect(events.some((e) => e.event_type === "cancelled")).toBe(true);
  });

  it("is a no-op when nothing is waiting for that contact", async () => {
    const tables = freshTables();
    state.db = makeFakeDb(tables);
    const cancelled = await cancelWaitingFlowRunsForContact("contact-nobody", "conversation_closed");
    expect(cancelled).toBe(0);
  });
});
