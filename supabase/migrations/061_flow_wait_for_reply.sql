-- ============================================================
-- 061_flow_wait_for_reply.sql
--
-- New conversational node type `wait_for_reply`: suspends a run after
-- a send_message "question" for a configured duration, waiting for
-- ANY customer reply. Two outgoing paths:
--   - next_node_key         → customer replied within the window
--   - timeout_node_key      → no reply arrived before the deadline
--     (e.g. an automatic follow-up send_message, then optionally
--     another wait_for_reply or an end node)
--
-- This is distinct from `wait` (workflow-mode only, always resumes
-- the same next_node_key — no branching on customer behavior) and
-- from collect_input/send_buttons/send_list (which only match a
-- SPECIFIC reply shape). wait_for_reply matches any reply at all and
-- adds a real timeout branch, which none of the existing node types
-- support.
--
-- flow_runs gets a new 'waiting_reply' status plus the two columns
-- the engine needs to resume on timeout: waiting_reply_until (the
-- deadline) and waiting_reply_timeout_node_key (where to resume if
-- the deadline passes unanswered). `idx_one_active_run_per_contact`
-- (migration 047) is widened to also cover 'waiting_reply' — without
-- that, a run parked at a wait_for_reply node wouldn't block a second
-- run from starting for the same contact, defeating the "one active
-- run per contact" invariant the whole runner relies on.
-- ============================================================

ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'send_template',
    'collect_input',
    'wait',
    'wait_for_reply',
    'condition',
    'randomizer',
    'set_tag',
    'start_flow',
    'stop_flow',
    'create_deal',
    'update_deal_stage',
    'update_deal_value',
    'mark_deal_won',
    'mark_deal_lost',
    'assign_conversation',
    'unassign_agent',
    'update_contact_field',
    'open_conversation',
    'set_conversation_pending',
    'close_conversation',
    'send_webhook',
    'handoff',
    'end'
  ));

ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_status_check;
ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_status_check
  CHECK (status IN (
    'active',
    'waiting_reply',    -- parked at a wait_for_reply node with a deadline
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed'
  ));

ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS waiting_reply_until TIMESTAMPTZ;
ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS waiting_reply_timeout_node_key TEXT;

-- Widen the one-active-run-per-contact index to also cover
-- 'waiting_reply' — a run parked here is still "the" active run for
-- this contact and must keep blocking a second run from starting.
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(user_id, contact_id)
  WHERE status IN ('active', 'waiting_reply') AND run_mode = 'conversational';

-- Cron sweep query: "find waiting_reply runs whose deadline has
-- passed" needs to be index-supported, same rationale as
-- idx_flow_runs_active_advanced (migration 010).
CREATE INDEX IF NOT EXISTS idx_flow_runs_waiting_reply_until
  ON flow_runs(waiting_reply_until)
  WHERE status = 'waiting_reply';
