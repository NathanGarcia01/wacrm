-- ============================================================
-- 033_broadcast_cost_per_message.sql
--
-- Per-message Meta cost the user paid, entered on the broadcast
-- detail page's "ROI do Disparo" card. Used together with the
-- broadcast's sent_count and the deals won from its recipients to
-- compute ROI.
--
-- Already applied directly against the remote project in a prior
-- session; this file documents that change for local/fresh
-- environments. Idempotent via IF NOT EXISTS.
-- ============================================================

alter table public.broadcasts
  add column if not exists cost_per_message numeric(10,4) default 0;
