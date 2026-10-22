-- Adds 'deal_created_by_flow' to flow_run_events.event_type — logged by
-- update_deal_stage's new fallback (src/lib/flows/engine.ts) when a
-- contact has no open deal and the node creates one instead of failing
-- the run with "no open deal for contact".

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
    'completed',
    'deal_created_by_flow'
  ));
