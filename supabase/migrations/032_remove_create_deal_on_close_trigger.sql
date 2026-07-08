-- ============================================================
-- 032_remove_create_deal_on_close_trigger.sql
--
-- Reverts the auto-open-a-fresh-deal-on-close behaviour added in
-- migration 031 (create_deal_on_close / deals_create_on_close). It
-- was firing for contacts who already had other open deals, creating
-- unwanted duplicate pipeline entries — see commit "fix: reverte
-- criacao automatica de deals para contatos existentes".
--
-- Already applied directly against the remote project in a prior
-- session; this file documents that change for local/fresh
-- environments. Idempotent via IF EXISTS.
-- ============================================================

drop trigger if exists deals_create_on_close on public.deals;
drop function if exists public.create_deal_on_close();
