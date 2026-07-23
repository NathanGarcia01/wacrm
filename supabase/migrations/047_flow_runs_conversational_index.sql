-- ============================================================
-- Fase H da unificação automations->flows.
--
-- Rewrites `idx_one_active_run_per_contact` (originally created in
-- 017_account_sharing.sql) to scope the "at most 1 active run per
-- contact" guarantee to run_mode='conversational' only.
--
-- Why: the conversational (chatbot) engine relies on this index to
-- guarantee a contact is never mid-two-conversations at once. But
-- workflow-mode flows (Fase E-G) are event-triggered and, like
-- automations, MANY can legitimately be "happening" to one contact
-- at the same time (e.g. a deal_won flow and an inactivity flow
-- both active for the same contact). Applying the old unscoped
-- index to workflow-mode runs would make the second one fail to
-- insert (23505 unique_violation) — a real regression once
-- workflow-mode flows exist.
--
-- After this migration: a contact can have 1 active conversational
-- run AND N active workflow runs simultaneously. Two conversational
-- runs for the same contact still collide (the guarantee that must
-- never break).
-- ============================================================

DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(account_id, contact_id)
  WHERE status = 'active' AND run_mode = 'conversational';
