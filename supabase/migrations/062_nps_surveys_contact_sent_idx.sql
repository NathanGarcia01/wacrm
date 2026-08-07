-- ============================================================
-- 062_nps_surveys_contact_sent_idx.sql
--
-- sendNpsSurvey's resend gate (src/lib/nps/send-survey.ts) now
-- checks "has this contact already gotten a sent/responded survey in
-- the last 24h" instead of the old per-conversation/attendance check
-- — every call does a WHERE contact_id = ? AND sent_at >= ? scan.
-- Index-supports that lookup so it stays cheap as nps_surveys grows.
-- ============================================================

create index if not exists nps_surveys_contact_sent_idx
  on public.nps_surveys(contact_id, sent_at);
