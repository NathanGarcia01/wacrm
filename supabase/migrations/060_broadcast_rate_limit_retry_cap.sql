-- ============================================================
-- 060_broadcast_rate_limit_retry_cap.sql
--
-- BARUERI 4/5/6 sat in status='sending' for over a day: the cron's
-- rate-limit handling (Meta error 130429) pauses the WHOLE broadcast
-- for an hour and always retries the SAME oldest pending recipient
-- first. When that recipient keeps triggering 130429 on every retry
-- (observed: several concurrent broadcasts sharing one WhatsApp
-- number, plus at least one genuinely stuck recipient per broadcast),
-- the broadcast loops hourly forever and never reaches
-- remainingPending = 0, so it can never flip to 'sent'.
--
-- rate_limit_hits counts CONSECUTIVE rate-limited ticks for a
-- broadcast. Once it crosses a cap (see cron/route.ts), the blocking
-- recipient is force-failed instead of retried again, so the
-- broadcast can make forward progress and eventually complete.
-- ============================================================

alter table public.broadcasts
  add column if not exists rate_limit_hits integer not null default 0;
