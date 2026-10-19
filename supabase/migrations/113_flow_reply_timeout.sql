-- ============================================================
-- 113_flow_reply_timeout.sql
--
-- "Tempo limite de resposta" — makes the wait_for_reply node's
-- deadline branch OPTIONAL (toggle, default on for already-saved
-- nodes) and adds the same optional deadline branch to collect_input
-- (previously: no timeout concept at all, waited forever).
--
-- No new columns: both node types reuse the deadline machinery
-- migration 061 already added to flow_runs (waiting_reply_until,
-- waiting_reply_timeout_node_key) — collect_input just starts using
-- status='waiting_reply' too, when its own timeout is enabled. The
-- new behavior lives entirely in JSONB config (collect_input gets
-- timeout_enabled/timeout_amount/timeout_unit/timeout_node_key/
-- timeout_max_resends; wait_for_reply gets timeout_enabled) — see
-- CollectInputNodeConfig / WaitForReplyNodeConfig in
-- src/lib/flows/types.ts.
--
-- What DOES need a migration:
--   - flow_runs.status gains 'cancelled' — used when a pending wait
--     is cut short by the conversation closing or the contact opting
--     out (see cancelWaitingFlowRunsForContact in engine.ts), so it
--     reads distinctly from 'timed_out' (deadline passed naturally)
--     in the run-history viewer.
--   - flow_run_events.event_type gains 'cancelled' to log that same
--     transition.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_status_check;
ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_status_check
  CHECK (status IN (
    'active',
    'waiting_reply',
    'completed',
    'handed_off',
    'timed_out',
    'cancelled',        -- conversation closed / contact opted out while waiting
    'paused_by_agent',
    'failed'
  ));

ALTER TABLE flow_run_events DROP CONSTRAINT IF EXISTS flow_run_events_event_type_check;
ALTER TABLE flow_run_events ADD CONSTRAINT flow_run_events_event_type_check
  CHECK (event_type IN (
    'started',
    'node_entered',
    'message_sent',
    'reply_received',
    'fallback_fired',
    'handoff',
    'timeout',
    'cancelled',
    'error',
    'completed'
  ));
