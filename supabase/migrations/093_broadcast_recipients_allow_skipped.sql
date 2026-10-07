-- ============================================================
-- 093_broadcast_recipients_allow_skipped.sql
--
-- Pre-existing bug, found while wiring Fase 5 Etapa 5 (opt-out
-- exclusion at send time): broadcast_recipients_status_check never
-- allowed 'skipped', even though migrations 040 (exclude_recent_days)
-- and 064 (deal_status_filter) both already write
-- status='skipped' in the cron (src/app/api/broadcasts/cron/
-- route.ts), the TS type RecipientStatus already includes 'skipped'
-- (src/types/index.ts), the detail page already has a 'skipped'
-- filter tab, and broadcast-status.ts already has its label/style.
-- Every one of those UPDATE calls has been silently rejected by this
-- CHECK constraint since the features shipped — the row stays
-- 'pending' until the 1h stale-pending sweep force-fails it with an
-- unrelated, misleading message ("Tentativa de envio expirou sem
-- confirmação"), masking the real exclusion reason.
--
-- Confirmed before writing this migration, in a transaction with
-- rollback: UPDATE ... SET status='skipped' raised check_violation
-- pre-fix, succeeded post-fix.
--
-- The aggregate trigger (migration 005, _bcast_cols_for_status) is
-- unaffected — 'skipped' already falls through its catch-all
-- (contributes to no counter column), so this doesn't need a
-- trigger change.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE public.broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status = ANY (ARRAY['pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped']));
