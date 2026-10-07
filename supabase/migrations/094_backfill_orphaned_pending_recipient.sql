-- ============================================================
-- 094_backfill_orphaned_pending_recipient.sql
--
-- One-off data correction, scoped to a single row discovered while
-- investigating the broadcast_recipients_status_check bug fixed in
-- migration 093.
--
-- broadcast_recipients.id = 'e97d2999-d665-407b-b584-13e799953222'
-- (broadcast "FIEB HIGIENIZADA 3", exclude_recent_days=30): the cron
-- tried to mark it 'skipped' (excluded — recently messaged) but the
-- UPDATE silently failed against the pre-093 CHECK constraint, so the
-- row stayed 'pending' forever with last_attempted_at never set. Its
-- parent broadcast is already 'sent' — the cron only ever picks up
-- broadcasts with status IN ('scheduled','sending'), so this row
-- would stay stuck 'pending' forever with no other way to resolve it.
--
-- Every other old stuck-pending row found during the same
-- investigation belongs to a broadcast that is still 'paused' —
-- those are deliberately NOT touched here. Resuming them lets the
-- now-fixed cron logic re-evaluate with today's data (a deal's
-- status or a contact's recent-send window may have changed since),
-- which is more correct than overwriting history with a guess.
--
-- Guarded by both id AND status='pending' so this is a no-op if
-- already applied or if the row's state has changed since.
-- ============================================================

UPDATE public.broadcast_recipients
SET status = 'skipped',
    error_message = 'Excluded — messaged within the last 30 day(s) [backfill pós-correção do bug da migration 093]'
WHERE id = 'e97d2999-d665-407b-b584-13e799953222'
  AND status = 'pending';
