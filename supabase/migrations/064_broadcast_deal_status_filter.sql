-- ============================================================
-- Broadcast audience filter: deal status within the selected
-- funnel stage (open/won/lost), for the pipeline_stage audience
-- type.
--
-- stage_id is promoted alongside deal_status_filter (previously
-- only inside `audience_filter` jsonb) so the cron worker can
-- re-check the deal's current status per recipient at actual send
-- time — a broadcast trickles out over many batches/days, so a
-- deal that matched the filter when the recipient list was built
-- can change status before the message actually goes out. Mirrors
-- exclude_recent_days (migration 040).
-- ============================================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS deal_status_filter text
  CHECK (deal_status_filter IN ('open', 'won', 'lost'));

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
