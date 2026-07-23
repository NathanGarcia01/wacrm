/**
 * Workflow-mode flow engine — the event-triggered, one-shot execution
 * path for `flows.run_mode = 'workflow'`, equivalent to
 * `src/lib/automations/engine.ts` but running on the flows graph
 * schema (`flow_nodes`/`flow_runs`) instead of automations' step tree.
 *
 * Deliberately a SEPARATE module from `engine.ts` (the conversational
 * chatbot runner), not a branch inside it: every conversational node
 * executor assumes `run.conversation_id!` / `run.contact_id!` are
 * always set (true for inbound-message-triggered runs), which isn't
 * true here — triggers like `deal_won` or `inactivity` have no inbound
 * message, so conversation/deal are resolved lazily on demand, exactly
 * like automations/engine.ts's `resolveConversationId` /
 * `resolveOpenDealId`. See the Fase E-M plan for the full rationale.
 *
 * Node-type coverage: every node type EXCEPT `send_buttons`,
 * `send_list`, and `collect_input` — those three exist solely to wait
 * for a customer's reply, a concept with no equivalent anywhere in
 * automations' step vocabulary. A workflow-mode flow that includes one
 * (nothing stops the shared builder from allowing it) fails loudly
 * (`unsupported_in_workflow_mode`) rather than silently hanging with
 * no way to ever resume.
 *
 * Suspension model: unlike the conversational engine (which suspends
 * at customer-facing nodes), workflow-mode suspends ONLY at `wait`
 * nodes, via the `flow_pending_executions` queue (migration 045) —
 * the workflow-mode mirror of `automation_pending_executions`. The
 * `/api/flows/pending-cron` route drains it.
 *
 * No exception-based unwind (unlike automations' `AutomationStopSignal`):
 * automations recurses into condition/randomizer branches, so unwinding
 * out of a nested branch needs a throw. Flows' graph model is a flat
 * loop — `stop_flow` just ends the run and returns, no stack to unwind.
 */

import type {
  AutomationTriggerType,
  ButtonClickedTriggerConfig,
  DealStageChangedTriggerConfig,
  InactivityTriggerConfig,
  KeywordMatchTriggerConfig,
  NpsReceivedTriggerConfig,
} from "@/types";
import { supabaseAdmin } from "./admin-client";
import { engineSendMedia, engineSendText } from "./meta-send";
import { sendNpsSurvey } from "@/lib/nps/send-survey";
import {
  endRun,
  evaluateConditionPredicate,
  loadAllNodes,
  loadFlow,
  logEvent,
  type AdminClient,
} from "./engine";
import type {
  AssignConversationNodeConfig,
  ConditionNodeConfig,
  CreateDealNodeConfig,
  FlowNodeRow,
  FlowRow,
  FlowRunRow,
  MarkDealLostNodeConfig,
  RandomizerNodeConfig,
  SendMediaNodeConfig,
  SendMessageNodeConfig,
  SendWebhookNodeConfig,
  SetTagNodeConfig,
  StartFlowNodeConfig,
  StartNodeConfig,
  UpdateContactFieldNodeConfig,
  UpdateDealStageNodeConfig,
  UpdateDealValueNodeConfig,
  WaitNodeConfig,
} from "./types";

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/** Mirrors automations' `AutomationContext` — same field set, since
 *  every trigger site already builds one of these for automations and
 *  Fase G wires it straight through to both engines. */
export interface WorkflowTriggerContext {
  message_text?: string;
  conversation_id?: string;
  vars?: Record<string, unknown>;
  tag_id?: string;
  agent_id?: string;
}

export interface RunFlowsForTriggerInput {
  accountId: string;
  triggerType: AutomationTriggerType;
  contactId?: string | null;
  context?: WorkflowTriggerContext;
}

/**
 * Fire all active workflow-mode flows matching the given trigger for
 * an account. Must never throw — callers use fire-and-forget from the
 * same sites that call `runAutomationsForTrigger`. Per-flow failures
 * are logged to `flow_run_events`, never surfaced to the caller.
 */
export async function runFlowsForTrigger(
  input: RunFlowsForTriggerInput,
): Promise<void> {
  try {
    const db = supabaseAdmin();

    // Tenant isolation — mirrors runAutomationsForTrigger's guard.
    // Every step below runs through the service-role client (bypasses
    // RLS), so a caller-supplied contactId must be verified against
    // the account before anything touches it.
    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from("contacts")
        .select("id")
        .eq("id", input.contactId)
        .eq("account_id", input.accountId)
        .maybeSingle();
      if (ownErr) {
        console.error("[workflow-engine] contact ownership check failed:", ownErr);
        return;
      }
      if (!owned) {
        console.warn(
          "[workflow-engine] contact not in account, refusing dispatch",
          input.contactId,
        );
        return;
      }
    }

    const { data: flows, error } = await db
      .from("flows")
      .select("*")
      .eq("account_id", input.accountId)
      .eq("trigger_type", input.triggerType)
      .eq("run_mode", "workflow")
      .eq("status", "active");

    if (error) {
      console.error("[workflow-engine] fetch failed:", error);
      return;
    }
    if (!flows || flows.length === 0) return;

    for (const flow of flows as FlowRow[]) {
      if (!(await triggerMatches(flow, input.context, input.contactId))) continue;
      try {
        await startWorkflowRun(flow, input.contactId ?? null, input.context ?? {});
      } catch (err) {
        console.error("[workflow-engine] start failed:", flow.id, err);
      }
    }
  } catch (err) {
    console.error("[workflow-engine] dispatch failed:", err);
  }
}

/**
 * Resume a run parked at a `wait` node. Called from
 * `/api/flows/pending-cron` after it grabs a due
 * `flow_pending_executions` row.
 */
export async function resumePendingWorkflowExecution(pending: {
  id: string;
  flow_id: string;
  flow_run_id: string;
  resume_node_key: string;
  context: WorkflowTriggerContext | null;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: run, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("id", pending.flow_run_id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !run) {
    console.error("[workflow-engine] resume: missing/inactive run", pending.flow_run_id, error);
    await markPending(pending.id, "failed");
    return;
  }

  const nodes = await loadAllNodes(db, pending.flow_id);
  try {
    await advanceWorkflow(
      db,
      run as FlowRunRow,
      pending.resume_node_key,
      nodes,
      pending.context ?? {},
    );
    await markPending(pending.id, "done");
  } catch (err) {
    console.error("[workflow-engine] resume failed:", err);
    await markPending(pending.id, "failed");
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function startWorkflowRun(
  flow: FlowRow,
  contactId: string | null,
  context: WorkflowTriggerContext,
): Promise<void> {
  const db = supabaseAdmin();
  if (!flow.entry_node_id) return;

  const { data: inserted, error } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      account_id: flow.account_id,
      user_id: flow.user_id,
      contact_id: contactId,
      conversation_id: context.conversation_id ?? null,
      run_mode: "workflow",
      status: "active",
      current_node_key: flow.entry_node_id,
      vars: context.vars ?? {},
    })
    .select("*")
    .maybeSingle();
  if (error || !inserted) {
    console.error("[workflow-engine] startWorkflowRun insert error:", error);
    return;
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, "started", flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
  });

  // Atomic counter, same RPC + rationale as the conversational engine's
  // startNewRun (concurrent runs on the same flow must never lose a count).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    console.error("[workflow-engine] execution_count rpc error:", incErr.message);
  }

  const nodes = await loadAllNodes(db, flow.id);
  await advanceWorkflow(db, run, flow.entry_node_id, nodes, context);
}

/**
 * Flat advance loop — walks auto-advancing nodes until it hits `wait`
 * (suspend via the pending-executions queue), a terminal node
 * (`stop_flow`/`handoff`/`end`), or a failure. Unlike the
 * conversational engine's `advanceFromNodeKey`, this never recurses
 * into a branch: `condition`/`randomizer` just repoint `currentKey`
 * and the same loop continues.
 */
async function advanceWorkflow(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
  context: WorkflowTriggerContext,
): Promise<void> {
  let currentKey: string | null = startNodeKey;
  // Defensive cap — mirrors the conversational engine's cycle guard.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return;
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, "error", currentKey, { reason: "node_not_found" });
      await endRun(db, run.id, "failed", "node_not_found");
      return;
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    switch (node.node_type) {
      case "start": {
        currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
        continue;
      }

      case "send_message": {
        const cfg = node.config as unknown as SendMessageNodeConfig;
        try {
          if (!run.contact_id) throw new Error("send_message needs a contact");
          const conversationId = await resolveConversationId(db, run);
          const { whatsapp_message_id } = await engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId,
            contactId: run.contact_id,
            text: interpolate(cfg.text, run, context),
          });
          await logEvent(db, run.id, "message_sent", node.node_key, {
            node_type: "send_message",
            whatsapp_message_id,
          });
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "send_text_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "send_text_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "send_media": {
        const cfg = node.config as unknown as SendMediaNodeConfig;
        try {
          if (!run.contact_id) throw new Error("send_media needs a contact");
          const conversationId = await resolveConversationId(db, run);
          const { whatsapp_message_id } = await engineSendMedia({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId,
            contactId: run.contact_id,
            kind: cfg.media_type,
            link: cfg.media_url,
            caption: cfg.caption ? interpolate(cfg.caption, run, context) : undefined,
            filename: cfg.filename,
          });
          await logEvent(db, run.id, "message_sent", node.node_key, {
            node_type: "send_media",
            media_type: cfg.media_type,
            whatsapp_message_id,
          });
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "send_media_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "send_media_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "wait": {
        const cfg = node.config as unknown as WaitNodeConfig;
        const ms = waitMs(cfg);
        const { error } = await db.from("flow_pending_executions").insert({
          flow_id: run.flow_id,
          flow_run_id: run.id,
          account_id: run.account_id,
          user_id: run.user_id,
          contact_id: run.contact_id,
          resume_node_key: cfg.next_node_key,
          context,
          run_at: new Date(Date.now() + ms).toISOString(),
          status: "pending",
        });
        if (error) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "wait_enqueue_failed",
            detail: error.message,
          });
          await endRun(db, run.id, "failed", "wait_enqueue_failed");
          return;
        }
        await logEvent(db, run.id, "node_entered", node.node_key, {
          waiting_for: `${cfg.amount} ${cfg.unit}`,
        });
        return;
      }

      case "condition": {
        const cfg = node.config as unknown as ConditionNodeConfig;
        let taken: boolean;
        try {
          taken = await evaluateWorkflowCondition(db, run, context, cfg);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "condition_evaluation_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "condition_evaluation_failed");
          return;
        }
        currentKey = taken ? cfg.true_next : cfg.false_next;
        await logEvent(db, run.id, "node_entered", node.node_key, {
          condition_result: taken ? "true" : "false",
          advancing_to: currentKey,
        });
        continue;
      }

      case "randomizer": {
        const cfg = node.config as unknown as RandomizerNodeConfig;
        const pct = Math.min(100, Math.max(0, cfg.split_percent ?? 50));
        const taken = Math.random() * 100 < pct;
        currentKey = taken ? cfg.true_next : cfg.false_next;
        await logEvent(db, run.id, "node_entered", node.node_key, {
          split_percent: pct,
          advancing_to: currentKey,
        });
        continue;
      }

      case "set_tag": {
        const cfg = node.config as unknown as SetTagNodeConfig;
        try {
          if (!run.contact_id) throw new Error("set_tag needs a contact");
          if (cfg.mode === "add") {
            await db
              .from("contact_tags")
              .upsert(
                { contact_id: run.contact_id, tag_id: cfg.tag_id },
                { onConflict: "contact_id,tag_id" },
              );
          } else {
            await db
              .from("contact_tags")
              .delete()
              .eq("contact_id", run.contact_id)
              .eq("tag_id", cfg.tag_id);
          }
        } catch (err) {
          // Non-fatal, mirrors the conversational engine's set_tag —
          // a tag-write failure shouldn't strand the run.
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "set_tag_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "start_flow": {
        const cfg = node.config as unknown as StartFlowNodeConfig;
        const chain =
          (context.vars?.__flow_chain__ as string[] | undefined) ?? [];
        if (chain.includes(run.flow_id) || chain.length >= 5) {
          await logEvent(db, run.id, "node_entered", node.node_key, {
            skipped: "flow chain limit reached or cycle detected",
          });
          currentKey = cfg.next_node_key;
          continue;
        }
        const target = await loadFlow(db, cfg.flow_id);
        if (!target || target.status !== "active" || target.run_mode !== "workflow") {
          await logEvent(db, run.id, "node_entered", node.node_key, {
            skipped: `flow ${cfg.flow_id} not found or not an active workflow`,
          });
          currentKey = cfg.next_node_key;
          continue;
        }
        try {
          await startWorkflowRun(target, run.contact_id, {
            ...context,
            vars: { ...(context.vars ?? {}), __flow_chain__: [...chain, run.flow_id] },
          });
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "start_flow_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "stop_flow": {
        await logEvent(db, run.id, "completed", node.node_key);
        await endRun(db, run.id, "completed", "stop_flow_node");
        return;
      }

      case "create_deal": {
        try {
          await executeCreateDeal(db, run, node.config as unknown as CreateDealNodeConfig, context);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "create_deal_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "create_deal_failed");
          return;
        }
        currentKey = (node.config as unknown as CreateDealNodeConfig).next_node_key;
        continue;
      }

      case "update_deal_stage": {
        const cfg = node.config as unknown as UpdateDealStageNodeConfig;
        try {
          if (!cfg.stage_id) throw new Error("update_deal_stage needs stage_id");
          const dealId = await resolveOpenDealId(db, run);
          await db
            .from("deals")
            .update({ stage_id: cfg.stage_id, updated_at: new Date().toISOString() })
            .eq("id", dealId)
            .eq("account_id", run.account_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "update_deal_stage_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "update_deal_stage_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "update_deal_value": {
        const cfg = node.config as unknown as UpdateDealValueNodeConfig;
        try {
          if (typeof cfg.value !== "number" || !Number.isFinite(cfg.value)) {
            throw new Error("update_deal_value needs a numeric value");
          }
          const dealId = await resolveOpenDealId(db, run);
          await db
            .from("deals")
            .update({ value: cfg.value, updated_at: new Date().toISOString() })
            .eq("id", dealId)
            .eq("account_id", run.account_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "update_deal_value_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "update_deal_value_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "mark_deal_won": {
        const cfg = node.config as { next_node_key: string };
        try {
          const dealId = await resolveOpenDealId(db, run);
          await db
            .from("deals")
            .update({ status: "won", updated_at: new Date().toISOString() })
            .eq("id", dealId)
            .eq("account_id", run.account_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "mark_deal_won_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "mark_deal_won_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "mark_deal_lost": {
        const cfg = node.config as unknown as MarkDealLostNodeConfig;
        try {
          const dealId = await resolveOpenDealId(db, run);
          // lost_at is set by the deals_set_lost_at DB trigger, same
          // as automations' mark_deal_lost.
          await db
            .from("deals")
            .update({
              status: "lost",
              lost_reason: cfg.reason ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dealId)
            .eq("account_id", run.account_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "mark_deal_lost_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "mark_deal_lost_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "assign_conversation": {
        const cfg = node.config as unknown as AssignConversationNodeConfig;
        try {
          if (!run.contact_id) throw new Error("assign_conversation needs a contact");
          let agentId = cfg.agent_id;
          if (cfg.mode === "round_robin") {
            const { data: profiles } = await db
              .from("profiles")
              .select("user_id")
              .eq("account_id", run.account_id);
            const memberIds = (profiles ?? [])
              .map((p) => p.user_id as string)
              .filter(Boolean);
            if (memberIds.length === 0) {
              await logEvent(db, run.id, "node_entered", node.node_key, {
                detail: "no agent resolved",
              });
              currentKey = cfg.next_node_key;
              continue;
            }
            const { data: assignedRows } = await db
              .from("conversations")
              .select("assigned_agent_id")
              .eq("account_id", run.account_id)
              .in("assigned_agent_id", memberIds)
              .neq("status", "closed");
            const load = new Map<string, number>(memberIds.map((id) => [id, 0]));
            for (const row of assignedRows ?? []) {
              const id = row.assigned_agent_id as string | null;
              if (id && load.has(id)) load.set(id, (load.get(id) ?? 0) + 1);
            }
            agentId = memberIds.reduce((best, id) =>
              (load.get(id) ?? 0) < (load.get(best) ?? 0) ? id : best, memberIds[0]);
          }
          if (!agentId) {
            await logEvent(db, run.id, "node_entered", node.node_key, {
              detail: "no agent resolved",
            });
            currentKey = cfg.next_node_key;
            continue;
          }
          await db
            .from("conversations")
            .update({ assigned_agent_id: agentId })
            .eq("account_id", run.account_id)
            .eq("contact_id", run.contact_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "assign_conversation_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "assign_conversation_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "unassign_agent": {
        const cfg = node.config as { next_node_key: string };
        try {
          if (!run.contact_id) throw new Error("unassign_agent needs a contact");
          await db
            .from("conversations")
            .update({ assigned_agent_id: null })
            .eq("account_id", run.account_id)
            .eq("contact_id", run.contact_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "unassign_agent_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "unassign_agent_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "update_contact_field": {
        const cfg = node.config as unknown as UpdateContactFieldNodeConfig;
        try {
          if (!run.contact_id) throw new Error("update_contact_field needs a contact");
          const value = interpolate(cfg.value, run, context);
          if (cfg.field.startsWith("custom:")) {
            const customFieldId = cfg.field.slice("custom:".length);
            if (!customFieldId) throw new Error(`field ${cfg.field} not writable`);
            const { data: field } = await db
              .from("custom_fields")
              .select("id")
              .eq("id", customFieldId)
              .eq("account_id", run.account_id)
              .maybeSingle();
            if (!field) throw new Error(`field ${cfg.field} not writable`);
            await db
              .from("contact_custom_values")
              .upsert(
                { contact_id: run.contact_id, custom_field_id: customFieldId, value },
                { onConflict: "contact_id,custom_field_id" },
              );
          } else {
            const allowed = new Set(["name", "email", "company"]);
            if (!allowed.has(cfg.field)) throw new Error(`field ${cfg.field} not writable`);
            await db
              .from("contacts")
              .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
              .eq("id", run.contact_id)
              .eq("account_id", run.account_id);
          }
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "update_contact_field_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "update_contact_field_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "open_conversation": {
        const cfg = node.config as { next_node_key: string };
        try {
          if (!run.contact_id) throw new Error("open_conversation needs a contact");
          await db
            .from("conversations")
            .update({ status: "open", updated_at: new Date().toISOString() })
            .eq("account_id", run.account_id)
            .eq("contact_id", run.contact_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "open_conversation_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "open_conversation_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "set_conversation_pending": {
        const cfg = node.config as { next_node_key: string };
        try {
          if (!run.contact_id) throw new Error("set_conversation_pending needs a contact");
          await db
            .from("conversations")
            .update({ status: "pending", updated_at: new Date().toISOString() })
            .eq("account_id", run.account_id)
            .eq("contact_id", run.contact_id);
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "set_conversation_pending_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "set_conversation_pending_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "close_conversation": {
        const cfg = node.config as { next_node_key: string };
        try {
          if (!run.contact_id) throw new Error("close_conversation needs a contact");
          await db
            .from("conversations")
            .update({ status: "closed", updated_at: new Date().toISOString() })
            .eq("account_id", run.account_id)
            .eq("contact_id", run.contact_id);
          // Best-effort NPS auto-send, mirrors automations' close_conversation
          // — a survey-send failure must never fail this step.
          resolveConversationId(db, run)
            .then((conversationId) =>
              sendNpsSurvey({
                accountId: run.account_id,
                userId: run.user_id,
                conversationId,
                triggerType: "manual_close",
              }),
            )
            .catch((err) =>
              console.error("[workflow-engine] nps auto-send on close failed:", err),
            );
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "close_conversation_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "close_conversation_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "send_webhook": {
        const cfg = node.config as unknown as SendWebhookNodeConfig;
        try {
          if (!cfg.url) throw new Error("send_webhook needs url");
          const body = cfg.body_template
            ? interpolate(cfg.body_template, run, context)
            : JSON.stringify(context);
          const res = await fetch(cfg.url, {
            method: "POST",
            headers: { "content-type": "application/json", ...(cfg.headers ?? {}) },
            body,
          });
          if (!res.ok) throw new Error(`webhook returned ${res.status}`);
          await logEvent(db, run.id, "node_entered", node.node_key, {
            webhook_status: res.status,
          });
        } catch (err) {
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "send_webhook_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(db, run.id, "failed", "send_webhook_failed");
          return;
        }
        currentKey = cfg.next_node_key;
        continue;
      }

      case "handoff": {
        const cfg = node.config as { assign_to?: string; note?: string };
        const convUpdate: Record<string, unknown> = {
          status: "pending",
          updated_at: new Date().toISOString(),
        };
        if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
        if (run.conversation_id) {
          await db.from("conversations").update(convUpdate).eq("id", run.conversation_id);
        }
        await logEvent(db, run.id, "handoff", node.node_key, {
          note: cfg.note ?? null,
          assigned_to: cfg.assign_to ?? null,
        });
        await endRun(db, run.id, "handed_off", "handoff_node");
        return;
      }

      case "end": {
        await logEvent(db, run.id, "completed", node.node_key);
        await endRun(db, run.id, "completed", "end_node");
        return;
      }

      case "send_buttons":
      case "send_list":
      case "collect_input": {
        // No customer-reply mechanism exists in workflow mode — these
        // node types only make sense in a conversational (inbound-
        // message-triggered) run. See module doc comment.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "unsupported_in_workflow_mode",
          node_type: node.node_type,
        });
        await endRun(db, run.id, "failed", "unsupported_in_workflow_mode");
        return;
      }

      default:
        await logEvent(db, run.id, "error", node.node_key, {
          reason: `unknown_node_type:${node.node_type}`,
        });
        await endRun(db, run.id, "failed", "unknown_node_type");
        return;
    }
  }
  // Safety break — mirrors the conversational engine's cycle guard.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
}

// ------------------------------------------------------------
// create_deal — long enough to warrant its own function, ported
// verbatim from automations/engine.ts's 'create_deal' case.
// ------------------------------------------------------------

async function executeCreateDeal(
  db: AdminClient,
  run: FlowRunRow,
  cfg: CreateDealNodeConfig,
  context: WorkflowTriggerContext,
): Promise<void> {
  if (!run.contact_id) throw new Error("create_deal needs a contact");

  // Duplicate guard — same rationale as automations: a re-triggered
  // event for the same contact shouldn't spawn a second open deal.
  const { data: existingOpenDeal } = await db
    .from("deals")
    .select("id")
    .eq("contact_id", run.contact_id)
    .eq("status", "open")
    .maybeSingle();
  if (existingOpenDeal) return;

  let pipelineId = cfg.pipeline_id;
  if (!pipelineId) {
    const { data: defaultPipeline } = await db
      .from("pipelines")
      .select("id")
      .eq("account_id", run.account_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    pipelineId = defaultPipeline?.id;
  }
  if (!pipelineId) throw new Error("create_deal: account has no pipeline");

  let stageId = cfg.stage_id;
  if (!stageId) {
    const { data: firstStage } = await db
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    stageId = firstStage?.id;
  }
  if (!stageId) throw new Error("create_deal: pipeline has no stages");

  const { data: acct } = await db
    .from("accounts")
    .select("default_currency")
    .eq("id", run.account_id)
    .maybeSingle();

  const needsContact = !cfg.title?.trim() || /\{\{\s*contact\./.test(cfg.title);
  let contactName = "";
  let contactPhone = "";
  if (needsContact) {
    const { data: contact } = await db
      .from("contacts")
      .select("name, phone")
      .eq("id", run.contact_id)
      .maybeSingle();
    contactName = contact?.name ?? "";
    contactPhone = contact?.phone ?? "";
  }
  const title = cfg.title?.trim()
    ? interpolate(cfg.title, run, context, { name: contactName, phone: contactPhone })
    : contactName || contactPhone;

  await db.from("deals").insert({
    account_id: run.account_id,
    user_id: run.user_id,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: run.contact_id,
    title,
    value: cfg.value ?? 0,
    currency: (acct as { default_currency?: string } | null)?.default_currency ?? "USD",
    status: "open",
  });
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Lazy conversation resolution + in-memory/DB cache, mirrors
 * automations' `resolveConversationId`. Cached onto `run.conversation_id`
 * (both in-memory and persisted) so a later resumed `wait` doesn't
 * need to re-resolve.
 */
async function resolveConversationId(
  db: AdminClient,
  run: FlowRunRow,
): Promise<string> {
  if (run.conversation_id) return run.conversation_id;
  if (!run.contact_id) throw new Error("cannot resolve conversation: no contact");
  const { data, error } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", run.account_id)
    .eq("contact_id", run.contact_id)
    .maybeSingle();
  if (error) throw new Error(`conversation lookup failed: ${error.message}`);
  if (!data?.id) throw new Error("no conversation for contact");
  run.conversation_id = data.id as string;
  await db.from("flow_runs").update({ conversation_id: run.conversation_id }).eq("id", run.id);
  return run.conversation_id;
}

/**
 * Resolve the contact's current open deal, mirrors automations'
 * `resolveOpenDealId` exactly (picks the most recently created open
 * deal when a contact somehow has more than one).
 */
async function resolveOpenDealId(db: AdminClient, run: FlowRunRow): Promise<string> {
  if (!run.contact_id) throw new Error("step needs a contact");
  const { data, error } = await db
    .from("deals")
    .select("id")
    .eq("account_id", run.account_id)
    .eq("contact_id", run.contact_id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`deal lookup failed: ${error.message}`);
  if (!data?.id) throw new Error("no open deal for contact");
  return data.id as string;
}

async function evaluateWorkflowCondition(
  db: AdminClient,
  run: FlowRunRow,
  context: WorkflowTriggerContext,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  if (cfg.subject === "message_content") {
    const text = (context.message_text ?? "").toString();
    return text.toLowerCase().includes((cfg.value ?? "").toLowerCase());
  }
  if (cfg.subject === "time_of_day") {
    // "HH:mm-HH:mm" — supports over-midnight ranges. Mirrors
    // automations' time_of_day condition exactly.
    const [from, to] = (cfg.subject_key ?? "").split("-");
    if (!from || !to) return false;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const parse = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const f = parse(from);
    const t = parse(to);
    return f <= t ? mins >= f && mins < t : mins >= f || mins < t;
  }

  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    if (!run.contact_id) {
      subjectValue = undefined;
    } else {
      const { count } = await db
        .from("contact_tags")
        .select("contact_id", { count: "exact", head: true })
        .eq("contact_id", run.contact_id)
        .eq("tag_id", cfg.subject_key);
      subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
    }
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!run.contact_id || !ALLOWED.includes(cfg.subject_key as AllowedField)) {
      subjectValue = undefined;
    } else {
      const { data } = await db
        .from("contacts")
        .select(cfg.subject_key)
        .eq("id", run.contact_id)
        .maybeSingle();
      const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
      subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
    }
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

function waitMs(cfg: WaitNodeConfig): number {
  const unitMs = cfg.unit === "days" ? 86_400_000 : cfg.unit === "hours" ? 3_600_000 : 60_000;
  return Math.max(1_000, cfg.amount * unitMs);
}

/**
 * `{{message.text}}` / `{{vars.*}}` / `{{contact.name}}` /
 * `{{contact.phone}}` interpolation — mirrors automations' `interpolate`
 * exactly (same placeholder vocabulary), since node config authors
 * expect the same templating in both engines.
 */
function interpolate(
  s: string,
  run: FlowRunRow,
  context: WorkflowTriggerContext,
  contact?: { name: string; phone: string },
): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split(".");
    if (ns === "message" && prop === "text") return String(context.message_text ?? "");
    if (ns === "vars" && prop) return String(run.vars[prop] ?? "");
    if (ns === "contact" && prop === "name") return contact?.name ?? "";
    if (ns === "contact" && prop === "phone") return contact?.phone ?? "";
    return "";
  });
}

async function triggerMatches(
  flow: FlowRow,
  ctx: WorkflowTriggerContext | undefined,
  contactId: string | null | undefined,
): Promise<boolean> {
  if (flow.trigger_type === "keyword_match") {
    const cfg = flow.trigger_config as unknown as KeywordMatchTriggerConfig;
    if (!cfg?.keywords || cfg.keywords.length === 0) return false;
    const text = (ctx?.message_text ?? "").toString();
    if (!text) return false;
    const haystack = cfg.case_sensitive ? text : text.toLowerCase();
    return cfg.keywords.some((raw) => {
      const k = cfg.case_sensitive ? raw : raw.toLowerCase();
      return cfg.match_type === "exact" ? haystack === k : haystack.includes(k);
    });
  }
  if (flow.trigger_type === "deal_stage_changed") {
    const cfg = flow.trigger_config as unknown as DealStageChangedTriggerConfig;
    const toStage = ctx?.vars?.to_stage_id;
    const fromStage = ctx?.vars?.from_stage_id;
    if (cfg?.to_stage_id && cfg.to_stage_id !== toStage) return false;
    if (cfg?.from_stage_id && cfg.from_stage_id !== fromStage) return false;
    return true;
  }
  if (flow.trigger_type === "button_clicked") {
    const cfg = flow.trigger_config as unknown as ButtonClickedTriggerConfig;
    if (!cfg?.button_text) return true;
    return cfg.button_text === ctx?.vars?.button_text;
  }
  if (flow.trigger_type === "nps_received") {
    const cfg = flow.trigger_config as unknown as NpsReceivedTriggerConfig;
    const rating = ctx?.vars?.rating;
    if (typeof rating !== "number") return false;
    if (typeof cfg?.min_rating === "number" && rating < cfg.min_rating) return false;
    return true;
  }
  if (flow.trigger_type === "inactivity") {
    const cfg = flow.trigger_config as unknown as InactivityTriggerConfig;
    const hoursCfg = Number(cfg?.hours) || 24;
    const elapsed = ctx?.vars?.inactive_hours;
    if (typeof elapsed !== "number" || elapsed < hoursCfg) return false;
    // Dedup: don't re-fire for the same contact on every cron tick —
    // mirrors automations' automation_logs check, adapted to flow_runs
    // (flows has no per-trigger log table; a started run for this
    // flow+contact since the cutoff is the equivalent signal).
    const lastMessageAt = ctx?.vars?.last_message_at;
    if (contactId && typeof lastMessageAt === "string") {
      const db = supabaseAdmin();
      const { count } = await db
        .from("flow_runs")
        .select("id", { count: "exact", head: true })
        .eq("flow_id", flow.id)
        .eq("contact_id", contactId)
        .gte("started_at", lastMessageAt);
      if ((count ?? 0) > 0) return false;
    }
    return true;
  }
  return true;
}

async function markPending(id: string, status: "done" | "failed") {
  await supabaseAdmin()
    .from("flow_pending_executions")
    .update({ status })
    .eq("id", id);
}
