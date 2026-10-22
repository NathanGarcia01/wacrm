-- Guards against the "cron was off for a long time, then turned on and
-- fired its entire backlog at once" failure mode discovered 2026-10-22:
-- funilly-nps sent 158 free-text NPS messages in ~30min, 150 of which
-- failed because the contact's last message was 5-84 days old (way past
-- Meta's 24h customer-service window for free-text sends).
--
-- Two independent guards:
--   1. NPS: a per-send 24h-window check (src/lib/nps/send-survey.ts) —
--      additive 'skipped_backlog' status so stale candidates are logged
--      once and never retried, instead of being silently skipped forever
--      (which would also keep showing up in every future scan).
--   2. Inactivity automations/flows: never fire for a quiet period that
--      started before the automation/flow was (re)activated — closes the
--      same backlog hole for whatever gets configured on 'inactivity'
--      next, even though none exist today.

ALTER TABLE nps_surveys DROP CONSTRAINT IF EXISTS nps_surveys_status_check;
ALTER TABLE nps_surveys ADD CONSTRAINT nps_surveys_status_check
  CHECK (status IN ('sent', 'responded', 'expired', 'sending', 'failed', 'skipped_backlog'));

ALTER TABLE automations ADD COLUMN IF NOT EXISTS activated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE flows ADD COLUMN IF NOT EXISTS activated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION bump_automation_activated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = true AND (OLD.is_active IS DISTINCT FROM true) THEN
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automations_bump_activated_at ON automations;
CREATE TRIGGER automations_bump_activated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION bump_automation_activated_at();

CREATE OR REPLACE FUNCTION bump_flow_activated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND (OLD.status IS DISTINCT FROM 'active') THEN
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flows_bump_activated_at ON flows;
CREATE TRIGGER flows_bump_activated_at
  BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION bump_flow_activated_at();
