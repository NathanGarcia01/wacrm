import { describe, it, expect } from "vitest";
import { validateFlowForActivation, reachableFromEntry } from "./validate";

const validFlow = {
  name: "Welcome",
  trigger_type: "keyword_match" as const,
  trigger_config: { keywords: ["support"] },
  entry_node_id: "start",
};

const validNodes = [
  { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "How can we help?",
      buttons: [
        { reply_id: "a", title: "A", next_node_key: "ho" },
        { reply_id: "b", title: "B", next_node_key: "ho" },
      ],
    },
  },
  { node_key: "ho", node_type: "handoff", config: {} },
];

describe("validateFlowForActivation — happy path", () => {
  it("produces no issues on a well-formed flow", () => {
    expect(validateFlowForActivation(validFlow, validNodes)).toEqual([]);
  });
});

describe("validateFlowForActivation — flow-level", () => {
  it("flags empty name", () => {
    expect(
      validateFlowForActivation({ ...validFlow, name: "" }, validNodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "flow", field: "name" }),
      ]),
    );
  });

  it("flags whitespace-only name", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, name: "   " },
      validNodes,
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing entry_node_id", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      validNodes,
    );
    expect(issues.some((i) => i.field === "entry_node_id")).toBe(true);
  });

  it("flags entry_node_id that doesn't exist in nodes", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "ghost" },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "entry_node_id" &&
          i.message.includes('"ghost"'),
      ),
    ).toBe(true);
  });

  it("flags empty node list", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      [],
    );
    expect(
      issues.some((i) => i.message.includes("at least one node")),
    ).toBe(true);
  });

  it("flags duplicate node_key", () => {
    const dupes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      dupes,
    );
    expect(
      issues.some(
        (i) =>
          i.message.includes("Duplicate node_key") &&
          i.node_key === "a",
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — trigger", () => {
  it("flags keyword trigger with no keywords", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: [] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.message.includes("at least one keyword"),
      ),
    ).toBe(true);
  });

  it("flags keyword trigger missing keywords field entirely", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, trigger_config: {} },
      validNodes,
    );
    expect(issues.some((i) => i.scope === "trigger")).toBe(true);
  });

  it("warns when keywords contain blanks", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: ["support", "", " "] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.severity === "warning" &&
          i.message.includes("blank"),
      ),
    ).toBe(true);
  });

  it("first_inbound_message trigger needs no config", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_type: "first_inbound_message",
        trigger_config: {},
      },
      validNodes,
    );
    expect(issues.filter((i) => i.scope === "trigger")).toEqual([]);
  });
});

describe("validateFlowForActivation — nodes", () => {
  it("flags send_buttons without text", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          buttons: [{ reply_id: "x", title: "X", next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.node_key === "b" && i.field === "text"),
    ).toBe(true);
  });

  it("flags send_buttons with zero buttons", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: { text: "Hi", buttons: [] },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  it("flags send_buttons with more than 3 buttons (Meta limit)", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "1", next_node_key: "h" },
            { reply_id: "2", title: "2", next_node_key: "h" },
            { reply_id: "3", title: "3", next_node_key: "h" },
            { reply_id: "4", title: "4", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at most 3"),
      ),
    ).toBe(true);
  });

  it("flags button title over 20 chars", () => {
    const longTitle = "x".repeat(21);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: longTitle, next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons.0.title" &&
          i.message.includes("over 20"),
      ),
    ).toBe(true);
  });

  it("flags button pointing at non-existent next node", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "Go", next_node_key: "ghost" },
          ],
        },
      },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "buttons.0.next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags duplicate button reply_ids", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "x", title: "X1", next_node_key: "h" },
            { reply_id: "x", title: "X2", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Duplicate button reply id")),
    ).toBe(true);
  });

  it("flags send_list with more than 10 rows total", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      reply_id: `r${i}`,
      title: `Row ${i}`,
      next_node_key: "h",
    }));
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [{ rows: eleven }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "l" &&
          i.field === "sections" &&
          i.message.includes("at most 10"),
      ),
    ).toBe(true);
  });

  it("flags list row title over 24 chars", () => {
    const longTitle = "x".repeat(25);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [
            {
              rows: [
                {
                  reply_id: "x",
                  title: longTitle,
                  next_node_key: "h",
                },
              ],
            },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("exceeds 24 chars")),
    ).toBe(true);
  });

  it("warns about unreachable nodes", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "handoff", config: {} },
      // Orphaned — nothing points at it.
      { node_key: "orphan", node_type: "end", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "orphan" &&
          i.severity === "warning" &&
          i.message.includes("unreachable"),
      ),
    ).toBe(true);
  });

  it("doesn't crash on unknown node_type — flags it", () => {
    const nodes = [
      { node_key: "s", node_type: "wibble", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Unknown node type")),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — send_media", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (mediaConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
    { node_key: "m", node_type: "send_media", config: mediaConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated send_media node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "document",
        media_url: "https://cdn.example/invoice.pdf",
        caption: "Your invoice",
        filename: "invoice.pdf",
        next_node_key: "h",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing media_url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_url"),
    ).toBe(true);
  });

  it("flags missing media_type", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_type"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "ghost",
      }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "m" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags caption exceeding 1024 chars", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        caption: "x".repeat(1025),
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "caption"),
    ).toBe(true);
  });

  it("contributes its next_node_key to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(set).toEqual(new Set(["s", "m", "h"]));
  });
});

describe("validateFlowForActivation — wait", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (waitConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "w" } },
    { node_key: "w", node_type: "wait", config: waitConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated wait node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ amount: 5, unit: "minutes", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing/non-positive amount", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ unit: "hours", next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "w" && i.field === "amount"),
    ).toBe(true);

    const zeroIssues = validateFlowForActivation(
      baseFlow,
      nodesWith({ amount: 0, unit: "hours", next_node_key: "h" }),
    );
    expect(
      zeroIssues.some((i) => i.node_key === "w" && i.field === "amount"),
    ).toBe(true);
  });

  it("flags missing/invalid unit", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ amount: 3, unit: "fortnights", next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "w" && i.field === "unit"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ amount: 1, unit: "days", next_node_key: "ghost" }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "w" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("contributes its next_node_key to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({ amount: 1, unit: "days", next_node_key: "h" }),
    );
    expect(set).toEqual(new Set(["s", "w", "h"]));
  });
});

describe("validateFlowForActivation — randomizer", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "r" } },
    { node_key: "r", node_type: "randomizer", config: cfg },
    { node_key: "a", node_type: "handoff", config: {} },
    { node_key: "b", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated randomizer node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ split_percent: 30, true_next: "a", false_next: "b" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags split_percent out of 0-100 range", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ split_percent: 150, true_next: "a", false_next: "b" }),
    );
    expect(
      issues.some((i) => i.node_key === "r" && i.field === "split_percent"),
    ).toBe(true);
  });

  it("flags missing true_next/false_next", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ split_percent: 50 }),
    );
    expect(issues.some((i) => i.field === "true_next")).toBe(true);
    expect(issues.some((i) => i.field === "false_next")).toBe(true);
  });

  it("contributes both branches to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({ split_percent: 50, true_next: "a", false_next: "b" }),
    );
    expect(set).toEqual(new Set(["s", "r", "a", "b"]));
  });
});

describe("validateFlowForActivation — start_flow", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "sf" } },
    { node_key: "sf", node_type: "start_flow", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated start_flow node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ flow_id: "11111111-1111-1111-1111-111111111111", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing flow_id", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "sf" && i.field === "flow_id"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ flow_id: "x", next_node_key: "ghost" }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "sf" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — stop_flow", () => {
  it("is a valid terminal node with no config required", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "x" } },
      { node_key: "x", node_type: "stop_flow", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(issues).toEqual([]);
  });
});

describe("validateFlowForActivation — create_deal", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "cd" } },
    { node_key: "cd", node_type: "create_deal", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated create_deal node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ title: "New lead", value: 100, next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("passes without pipeline_id/stage_id/value (resolved lazily at run time)", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ title: "New lead", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing title", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "cd" && i.field === "title"),
    ).toBe(true);
  });

  it("flags a negative value", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ title: "x", value: -5, next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "cd" && i.field === "value"),
    ).toBe(true);
  });

  it("flags missing next_node_key", () => {
    const issues = validateFlowForActivation(baseFlow, nodesWith({ title: "x" }));
    expect(
      issues.some((i) => i.node_key === "cd" && i.field === "next_node_key"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — update_deal_stage", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "uds" } },
    { node_key: "uds", node_type: "update_deal_stage", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ stage_id: "stage-1", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing stage_id", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "uds" && i.field === "stage_id"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — update_deal_value", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "udv" } },
    { node_key: "udv", node_type: "update_deal_value", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ value: 500, next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags a missing/non-numeric value", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "udv" && i.field === "value"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — mark_deal_won", () => {
  it("passes with just a next_node_key", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      [
        { node_key: "s", node_type: "start", config: { next_node_key: "mdw" } },
        { node_key: "mdw", node_type: "mark_deal_won", config: { next_node_key: "h" } },
        { node_key: "h", node_type: "handoff", config: {} },
      ],
    );
    expect(issues).toEqual([]);
  });

  it("flags missing next_node_key", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      [
        { node_key: "s", node_type: "start", config: { next_node_key: "mdw" } },
        { node_key: "mdw", node_type: "mark_deal_won", config: {} },
      ],
    );
    expect(
      issues.some((i) => i.node_key === "mdw" && i.field === "next_node_key"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — mark_deal_lost", () => {
  it("passes with an optional reason and a next_node_key", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      [
        { node_key: "s", node_type: "start", config: { next_node_key: "mdl" } },
        {
          node_key: "mdl",
          node_type: "mark_deal_lost",
          config: { reason: "no budget", next_node_key: "h" },
        },
        { node_key: "h", node_type: "handoff", config: {} },
      ],
    );
    expect(issues).toEqual([]);
  });

  it("flags missing next_node_key", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      [
        { node_key: "s", node_type: "start", config: { next_node_key: "mdl" } },
        { node_key: "mdl", node_type: "mark_deal_lost", config: {} },
      ],
    );
    expect(
      issues.some((i) => i.node_key === "mdl" && i.field === "next_node_key"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — assign_conversation", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "ac" } },
    { node_key: "ac", node_type: "assign_conversation", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes in round_robin mode without an agent_id", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ mode: "round_robin", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("passes in specific mode with an agent_id", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ mode: "specific", agent_id: "u1", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags specific mode without an agent_id", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ mode: "specific", next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "ac" && i.field === "agent_id"),
    ).toBe(true);
  });

  it("flags a missing/invalid mode", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "ac" && i.field === "mode"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — update_contact_field", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "ucf" } },
    { node_key: "ucf", node_type: "update_contact_field", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ field: "name", value: "x", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags a missing field", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ value: "x", next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "ucf" && i.field === "field"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — unassign_agent / open_conversation / set_conversation_pending / close_conversation", () => {
  const types = [
    "unassign_agent",
    "open_conversation",
    "set_conversation_pending",
    "close_conversation",
  ] as const;

  for (const nodeType of types) {
    it(`${nodeType} passes with just a next_node_key`, () => {
      const issues = validateFlowForActivation(
        { ...validFlow, entry_node_id: "s" },
        [
          { node_key: "s", node_type: "start", config: { next_node_key: "n" } },
          { node_key: "n", node_type: nodeType, config: { next_node_key: "h" } },
          { node_key: "h", node_type: "handoff", config: {} },
        ],
      );
      expect(issues).toEqual([]);
    });

    it(`${nodeType} flags missing next_node_key`, () => {
      const issues = validateFlowForActivation(
        { ...validFlow, entry_node_id: "s" },
        [
          { node_key: "s", node_type: "start", config: { next_node_key: "n" } },
          { node_key: "n", node_type: nodeType, config: {} },
        ],
      );
      expect(
        issues.some((i) => i.node_key === "n" && i.field === "next_node_key"),
      ).toBe(true);
    });
  }
});

describe("validateFlowForActivation — send_webhook", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "sw" } },
    { node_key: "sw", node_type: "send_webhook", config: cfg },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ url: "https://example.com/hook", next_node_key: "h" }),
    );
    expect(issues).toEqual([]);
  });

  it("flags a missing url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "sw" && i.field === "url"),
    ).toBe(true);
  });

  it("flags an invalid url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ url: "not-a-url", next_node_key: "h" }),
    );
    expect(
      issues.some((i) => i.node_key === "sw" && i.field === "url"),
    ).toBe(true);
  });

  it("flags missing next_node_key", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ url: "https://example.com/hook" }),
    );
    expect(
      issues.some((i) => i.node_key === "sw" && i.field === "next_node_key"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — condition on message_content", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "c" } },
    { node_key: "c", node_type: "condition", config: cfg },
    { node_key: "a", node_type: "handoff", config: {} },
    { node_key: "b", node_type: "handoff", config: {} },
  ];

  it("passes with just a value (no subject_key/operator needed)", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        subject: "message_content",
        value: "cancel",
        true_next: "a",
        false_next: "b",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags a missing value", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ subject: "message_content", true_next: "a", false_next: "b" }),
    );
    expect(
      issues.some((i) => i.node_key === "c" && i.field === "value"),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — condition on time_of_day", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (cfg: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "c" } },
    { node_key: "c", node_type: "condition", config: cfg },
    { node_key: "a", node_type: "handoff", config: {} },
    { node_key: "b", node_type: "handoff", config: {} },
  ];

  it("passes with a valid HH:mm-HH:mm window (no operator/value needed)", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        subject: "time_of_day",
        subject_key: "18:00-09:00",
        true_next: "a",
        false_next: "b",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags a malformed window", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        subject: "time_of_day",
        subject_key: "not-a-window",
        true_next: "a",
        false_next: "b",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "c" && i.field === "subject_key"),
    ).toBe(true);
  });

  it("flags a missing window", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({ subject: "time_of_day", true_next: "a", false_next: "b" }),
    );
    expect(
      issues.some((i) => i.node_key === "c" && i.field === "subject_key"),
    ).toBe(true);
  });
});

describe("reachableFromEntry", () => {
  it("walks the graph from the entry", () => {
    const set = reachableFromEntry("start", validNodes);
    expect(set.has("start")).toBe(true);
    expect(set.has("menu")).toBe(true);
    expect(set.has("ho")).toBe(true);
  });

  it("returns the entry alone when no edges lead out", () => {
    const set = reachableFromEntry("only", [
      { node_key: "only", node_type: "handoff", config: {} },
    ]);
    expect(set).toEqual(new Set(["only"]));
  });

  it("survives a cycle (visited guard)", () => {
    const nodes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Loop",
          buttons: [{ reply_id: "x", title: "Back", next_node_key: "a" }],
        },
      },
    ];
    const set = reachableFromEntry("a", nodes);
    expect(set).toEqual(new Set(["a", "b"]));
  });
});
