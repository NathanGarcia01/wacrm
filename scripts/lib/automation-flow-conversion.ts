/**
 * Pure tree→graph conversion logic for the automations→flows migration
 * script (scripts/migrate-automations-to-flows.ts). Extracted into its
 * own module — with no DB calls and no top-level side effects — so it
 * can be unit-tested directly; the CLI script only adds I/O around it.
 *
 * See the doc comment at the top of migrate-automations-to-flows.ts
 * for the full rationale behind the conversion rules, the wait-in-branch
 * limitation, and the start_flow two-pass resolution this module sets
 * up (but doesn't perform — that's pass 2, in the CLI script, since it
 * needs the full automation_id→flow_id map across every automation).
 */

export const PENDING_PREFIX = "PENDING:";

export interface StepNode {
  id: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: StepNode[]; no: StepNode[] };
}

export interface GeneratedNode {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export interface ConversionResult {
  ok: true;
  nodes: GeneratedNode[];
  entryNodeKey: string;
}
export interface ConversionFailure {
  ok: false;
  reason: string;
}

export function containsWait(steps: StepNode[]): boolean {
  return steps.some((s) => {
    if (s.step_type === "wait") return true;
    if (s.step_type === "condition" || s.step_type === "randomizer") {
      return containsWait(s.branches.yes) || containsWait(s.branches.no);
    }
    return false;
  });
}

export function mapConditionSubject(cfg: Record<string, unknown>): {
  subject: string;
  subject_key: string;
  operator: string;
} {
  const subject = cfg.subject as string | undefined;
  const operand = typeof cfg.operand === "string" ? cfg.operand : "";
  switch (subject) {
    case "tag_presence":
      return { subject: "tag", subject_key: operand, operator: "present" };
    case "contact_field":
      return { subject: "contact_field", subject_key: operand, operator: "equals" };
    case "message_content":
      return { subject: "message_content", subject_key: "", operator: "contains" };
    case "time_of_day":
      // operator is ignored by the executor for this subject.
      return { subject: "time_of_day", subject_key: operand, operator: "equals" };
    default:
      return { subject: "var", subject_key: operand, operator: "equals" };
  }
}

/** 1:1 field-preserving mappings — automations' step_config already
 *  matches the flow node config shape, just plus `next_node_key`. */
export function mapSimpleStep(
  step: StepNode,
  next: string,
): { node_type: string; config: Record<string, unknown> } {
  const cfg = step.step_config;
  switch (step.step_type) {
    case "send_message":
      return { node_type: "send_message", config: { text: cfg.text ?? "", next_node_key: next } };
    case "send_template":
      return {
        node_type: "send_template",
        config: {
          template_name: cfg.template_name ?? "",
          language: cfg.language,
          variables: cfg.variables ?? {},
          next_node_key: next,
        },
      };
    case "add_tag":
      return { node_type: "set_tag", config: { mode: "add", tag_id: cfg.tag_id ?? "", next_node_key: next } };
    case "remove_tag":
      return {
        node_type: "set_tag",
        config: { mode: "remove", tag_id: cfg.tag_id ?? "", next_node_key: next },
      };
    case "assign_conversation":
      return {
        node_type: "assign_conversation",
        config: { mode: cfg.mode ?? "round_robin", agent_id: cfg.agent_id, next_node_key: next },
      };
    case "unassign_agent":
      return { node_type: "unassign_agent", config: { next_node_key: next } };
    case "update_contact_field":
      return {
        node_type: "update_contact_field",
        config: { field: cfg.field ?? "name", value: cfg.value ?? "", next_node_key: next },
      };
    case "create_deal":
      return {
        node_type: "create_deal",
        config: {
          pipeline_id: cfg.pipeline_id,
          stage_id: cfg.stage_id,
          title: cfg.title ?? "",
          value: cfg.value,
          next_node_key: next,
        },
      };
    case "update_deal_stage":
      return {
        node_type: "update_deal_stage",
        config: { stage_id: cfg.stage_id ?? "", next_node_key: next },
      };
    case "update_deal_value":
      return { node_type: "update_deal_value", config: { value: cfg.value ?? 0, next_node_key: next } };
    case "mark_deal_won":
      return { node_type: "mark_deal_won", config: { next_node_key: next } };
    case "mark_deal_lost":
      return { node_type: "mark_deal_lost", config: { reason: cfg.reason, next_node_key: next } };
    case "send_webhook":
      return {
        node_type: "send_webhook",
        config: { url: cfg.url ?? "", headers: cfg.headers, body_template: cfg.body_template, next_node_key: next },
      };
    case "open_conversation":
      return { node_type: "open_conversation", config: { next_node_key: next } };
    case "set_conversation_pending":
      return { node_type: "set_conversation_pending", config: { next_node_key: next } };
    case "close_conversation":
      return { node_type: "close_conversation", config: { next_node_key: next } };
    case "start_automation":
      // Resolved in pass 2 (in the CLI script) — see this file's header.
      return {
        node_type: "start_flow",
        config: { flow_id: `${PENDING_PREFIX}${cfg.automation_id}`, next_node_key: next },
      };
    default:
      throw new Error(`unmapped automation step_type: "${step.step_type}"`);
  }
}

/**
 * Converts one automation's step tree into a flat node list. Returns
 * `{ ok: false }` (no nodes created) when the wait-in-branch limitation
 * applies anywhere in the tree — see migrate-automations-to-flows.ts's
 * file-level doc comment for the full rationale.
 */
export function convertTree(rootSteps: StepNode[]): ConversionResult | ConversionFailure {
  const nodes: GeneratedNode[] = [];
  let keyCounter = 0;
  const nextKey = () => `n${keyCounter++}`;

  const endKey = nextKey();
  nodes.push({ node_key: endKey, node_type: "end", config: {} });

  let failure: string | null = null;

  function walk(steps: StepNode[], continuation: string): string {
    if (failure) return continuation;
    if (steps.length === 0) return continuation;

    // stop_automation truncates the scope — nothing after it (in this
    // same scope) ever runs, matching AutomationStopSignal's
    // synchronous unwind in the real engine.
    const stopIdx = steps.findIndex((s) => s.step_type === "stop_automation");
    const effective = stopIdx === -1 ? steps : steps.slice(0, stopIdx + 1);

    const keys = effective.map(() => nextKey());

    for (let i = 0; i < effective.length; i += 1) {
      const step = effective[i];
      const key = keys[i];
      const next = i + 1 < effective.length ? keys[i + 1] : continuation;

      if (step.step_type === "stop_automation") {
        nodes.push({ node_key: key, node_type: "stop_flow", config: {} });
        continue;
      }

      if (step.step_type === "wait") {
        nodes.push({
          node_key: key,
          node_type: "wait",
          config: {
            amount: step.step_config.amount ?? 5,
            unit: step.step_config.unit ?? "minutes",
            next_node_key: next,
          },
        });
        continue;
      }

      if (step.step_type === "condition" || step.step_type === "randomizer") {
        const hasWait = containsWait(step.branches.yes) || containsWait(step.branches.no);
        if (hasWait && next !== endKey) {
          failure =
            `step ${step.id} (${step.step_type}) has a branch containing "wait", ` +
            `and other steps run after it in the automation — automations lets ` +
            `those run immediately in parallel with the wait; flows' single ` +
            `current-node-per-run model can't express that. Recreate this ` +
            `automation manually in the flows builder instead.`;
          return continuation;
        }
        const yesFirst = walk(step.branches.yes, next);
        if (failure) return continuation;
        const noFirst = walk(step.branches.no, next);
        if (failure) return continuation;

        if (step.step_type === "condition") {
          const mapped = mapConditionSubject(step.step_config);
          nodes.push({
            node_key: key,
            node_type: "condition",
            config: { ...mapped, value: step.step_config.value, true_next: yesFirst, false_next: noFirst },
          });
        } else {
          nodes.push({
            node_key: key,
            node_type: "randomizer",
            config: {
              split_percent: step.step_config.split_percent ?? 50,
              true_next: yesFirst,
              false_next: noFirst,
            },
          });
        }
        continue;
      }

      const mapped = mapSimpleStep(step, next);
      nodes.push({ node_key: key, ...mapped });
    }

    return keys[0];
  }

  const entryNodeKey = walk(rootSteps, endKey);
  if (failure) return { ok: false, reason: failure };
  return { ok: true, nodes, entryNodeKey };
}
