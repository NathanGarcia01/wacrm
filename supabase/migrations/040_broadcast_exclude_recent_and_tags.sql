-- ============================================================
-- Broadcast anti-duplicate send-time guard + auto-tag on send.
--
-- exclude_recent_days: previously the "exclude contacts messaged in
-- the last N days" setting only lived inside `audience_filter` (jsonb)
-- and was only ever consulted once, client-side, when the broadcast's
-- recipient rows were first created. Broadcasts trickle out over many
-- batches/days (cadence + business-hours gating), so a contact could
-- pass that one-time check and still end up double-messaged by an
-- overlapping broadcast created/sent in between. Promoting it to a
-- real column lets the cron re-check it per recipient at actual send
-- time (see src/app/api/broadcasts/cron/route.ts).
--
-- tags_to_add: lets a broadcast tag every contact it successfully
-- messages, applied by the cron right after each successful send.
-- ============================================================

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS tags_to_add jsonb DEFAULT '[]';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS exclude_recent_days integer DEFAULT 0;

-- 'skipped' — a recipient whose send was skipped at cron time by the
-- exclude_recent_days guard, distinct from 'failed' (a genuine send
-- error) and 'pending' (not attempted yet).
ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped'));
