-- ============================================================
-- 063_broadcast_recipient_last_attempted_at.sql
--
-- Broadcasts occasionally get stuck in status='sending' forever with
-- some recipients left status='pending' — e.g. a Supabase write that
-- silently fails right after a Meta send succeeds leaves the recipient
-- pending even though the message went out, and the cron never marks
-- the broadcast 'sent' because remainingPending never reaches 0.
--
-- last_attempted_at is set right before the cron actually calls the
-- Meta API for a recipient — NOT at broadcast creation. That's what
-- lets the cron tell "genuinely stuck after an attempt" apart from
-- "still legitimately queued, hasn't had its turn yet" — large/paced
-- broadcasts (batch_interval_minutes up to 60, business-hours gating)
-- routinely leave recipients pending for hours by design, and using
-- created_at for staleness would incorrectly fail those. See
-- cron/route.ts for the sweep that force-fails pending recipients
-- whose last_attempted_at is over an hour old.
-- ============================================================

alter table public.broadcast_recipients
  add column if not exists last_attempted_at timestamptz;
