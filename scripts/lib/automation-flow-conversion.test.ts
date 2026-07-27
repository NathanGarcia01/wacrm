import { describe, it, expect } from "vitest";
import { containsWait, convertTree, mapConditionSubject, type StepNode } from "./automation-flow-conversion";

function step(
  step_type: string,
  step_config: Record<string, unknown> = {},
  branches: { yes?: StepNode[]; no?: StepNode[] } = {},
): StepNode {
  return {
    id: `${step_type}-${Math.random().toString(36).slice(2, 8)}`,
    step_type,
    step_config,
    branches: { yes: branches.yes ?? [], no: branches.no ?? [] },
  };
}

/** Follows next_node_key/true_next/false_next pointers from `entry` to
 *  build the list of node_types actually reachable, in visitation
 *  order — the cheapest way to assert "the graph does what the tree
 *  meant" without hand-checking every node_key by hand. */
function trace(
  nodes: { node_key: string; node_type: string; config: Record<string, unknown> }[],
  entry: string,
  branchChoice: "true" | "false" = "true",
): string[] {
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const path: string[] = [];
  let current: string | undefined = entry;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byKey.get(current);
    if (!node) break;
    path.push(node.node_type);
    if (node.node_type === "end" || node.node_type === "stop_flow") break;
    if (node.node_type === "condition" || node.node_type === "randomizer") {
      current = branchChoice === "true" ? (node.config.true_next as string) : (node.config.false_next as string);
    } else {
      current = node.config.next_node_key as string | undefined;
    }
  }
  return path;
}

describe("convertTree — flat (no branches)", () => {
  it("chains steps in position order and terminates at the synthetic end node", () => {
    const tree = [
      step("send_message", { text: "hi" }),
      step("assign_conversation", { mode: "round_robin" }),
      step("close_conversation"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trace(result.nodes, result.entryNodeKey)).toEqual([
      "send_message",
      "assign_conversation",
      "close_conversation",
      "end",
    ]);
  });

  it("a root-level wait is always safe — nothing else runs in parallel with it", () => {
    const tree = [step("wait", { amount: 1, unit: "hours" }), step("send_message", { text: "resumed" })];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trace(result.nodes, result.entryNodeKey)).toEqual(["wait", "send_message", "end"]);
  });

  it("stop_automation truncates the scope — nothing after it is reachable", () => {
    const tree = [
      step("send_message", { text: "before" }),
      step("stop_automation"),
      step("send_message", { text: "never runs" }),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trace(result.nodes, result.entryNodeKey)).toEqual(["send_message", "stop_flow"]);
    // The unreachable step must not even exist as a dangling node.
    expect(result.nodes.some((n) => n.config.text === "never runs")).toBe(false);
  });
});

describe("convertTree — branch stitching", () => {
  it("stitches both branches back to the step after the condition", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "tag-1" }, {
        yes: [step("add_tag", { tag_id: "tag-2" })],
        no: [step("remove_tag", { tag_id: "tag-2" })],
      }),
      step("close_conversation"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(trace(result.nodes, result.entryNodeKey, "true")).toEqual([
      "condition",
      "set_tag",
      "close_conversation",
      "end",
    ]);
    expect(trace(result.nodes, result.entryNodeKey, "false")).toEqual([
      "condition",
      "set_tag",
      "close_conversation",
      "end",
    ]);
  });

  it("an empty branch stitches straight through to the continuation", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "t1" }, {
        yes: [step("send_message", { text: "has tag" })],
        // no branch left empty
      }),
      step("close_conversation"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(trace(result.nodes, result.entryNodeKey, "false")).toEqual(["condition", "close_conversation", "end"]);
  });

  it("nested condition inside a branch stitches all the way back to the root continuation", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "outer" }, {
        yes: [
          step("condition", { subject: "tag_presence", operand: "inner" }, {
            yes: [step("send_message", { text: "both true" })],
            no: [step("send_message", { text: "outer true only" })],
          }),
        ],
      }),
      step("mark_deal_won"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // outer=true, inner=true → both messages' path, then back out to
    // mark_deal_won (the step after the OUTER condition), then end.
    expect(trace(result.nodes, result.entryNodeKey, "true")).toEqual([
      "condition",
      "condition",
      "send_message",
      "mark_deal_won",
      "end",
    ]);
  });

  it("randomizer uses the same true_next/false_next stitching as condition", () => {
    const tree = [
      step("randomizer", { split_percent: 50 }, {
        yes: [step("send_message", { text: "A" })],
        no: [step("send_message", { text: "B" })],
      }),
      step("close_conversation"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trace(result.nodes, result.entryNodeKey, "true")).toEqual([
      "randomizer",
      "send_message",
      "close_conversation",
      "end",
    ]);
  });
});

describe("convertTree — wait-in-branch limitation", () => {
  it("flags an automation where a branch's wait is followed by more root-scope steps", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "t1" }, {
        yes: [step("wait", { amount: 1, unit: "hours" }), step("send_message", { text: "after wait" })],
      }),
      // This step is the whole problem: automations would run it
      // immediately (not waiting), flows cannot express that.
      step("close_conversation"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("wait");
  });

  it("does NOT flag a branch wait when nothing follows the condition anywhere up the chain", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "t1" }, {
        yes: [step("wait", { amount: 1, unit: "hours" }), step("send_message", { text: "after wait" })],
        // no branch empty, and the condition is the LAST thing in root scope
      }),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trace(result.nodes, result.entryNodeKey, "true")).toEqual(["condition", "wait", "send_message", "end"]);
  });

  it("flags when the wait is nested two levels deep and an ancestor has trailing steps", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "outer" }, {
        yes: [
          step("condition", { subject: "tag_presence", operand: "inner" }, {
            yes: [step("wait", { amount: 5, unit: "minutes" })],
          }),
          // sibling of the inner condition, inside the OUTER branch —
          // still a problem: it runs immediately when the inner
          // condition's branch call returns from hitting wait.
          step("send_message", { text: "runs immediately, doesn't wait" }),
        ],
      }),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(false);
  });

  it("does not flag unrelated branches that have no wait at all", () => {
    const tree = [
      step("condition", { subject: "tag_presence", operand: "t1" }, {
        yes: [step("send_message", { text: "no wait here" })],
        no: [step("send_message", { text: "nor here" })],
      }),
      step("close_conversation"),
    ];
    const result = convertTree(tree);
    expect(result.ok).toBe(true);
  });
});

describe("mapConditionSubject", () => {
  it("maps tag_presence to tag/present", () => {
    expect(mapConditionSubject({ subject: "tag_presence", operand: "tag-1" })).toEqual({
      subject: "tag",
      subject_key: "tag-1",
      operator: "present",
    });
  });

  it("maps contact_field to contact_field/equals", () => {
    expect(mapConditionSubject({ subject: "contact_field", operand: "email" })).toEqual({
      subject: "contact_field",
      subject_key: "email",
      operator: "equals",
    });
  });

  it("maps message_content to message_content/contains with no subject_key", () => {
    expect(mapConditionSubject({ subject: "message_content" })).toEqual({
      subject: "message_content",
      subject_key: "",
      operator: "contains",
    });
  });

  it("maps time_of_day, carrying the HH:mm-HH:mm window as subject_key", () => {
    expect(mapConditionSubject({ subject: "time_of_day", operand: "18:00-09:00" })).toEqual({
      subject: "time_of_day",
      subject_key: "18:00-09:00",
      operator: "equals",
    });
  });
});

describe("containsWait", () => {
  it("finds a wait nested arbitrarily deep in either branch", () => {
    const tree = [
      step("condition", {}, {
        yes: [step("condition", {}, { no: [step("wait")] })],
      }),
    ];
    expect(containsWait(tree)).toBe(true);
  });

  it("returns false when there's no wait anywhere", () => {
    const tree = [step("condition", {}, { yes: [step("send_message")], no: [step("close_conversation")] })];
    expect(containsWait(tree)).toBe(false);
  });
});
