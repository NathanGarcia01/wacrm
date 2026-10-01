-- ============================================================
-- 067_meta_ad_referral_tracking.sql
--
-- Captures Meta Ads click-to-WhatsApp referral data. When a contact
-- taps a "Enviar mensagem" CTA on a Meta ad and sends the resulting
-- first WhatsApp message, the Cloud API webhook includes a
-- `message.referral` object identifying the ad that drove the click.
-- The webhook (src/app/api/whatsapp/webhook/route.ts) persists it here
-- so ad performance can be tied back to CRM outcomes (contacts, deals).
--
-- ad_name / ad_set_name / ad_campaign_name are resolved asynchronously
-- via a follow-up Graph API call keyed on ad_source_id — they may lag
-- a few seconds behind the other ad_* columns, which are written
-- directly from the webhook payload.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS ad_headline text,
ADD COLUMN IF NOT EXISTS ad_source_id text,
ADD COLUMN IF NOT EXISTS ad_body text,
ADD COLUMN IF NOT EXISTS ad_ctwa_clid text,
ADD COLUMN IF NOT EXISTS ad_name text,
ADD COLUMN IF NOT EXISTS ad_set_name text,
ADD COLUMN IF NOT EXISTS ad_campaign_name text;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ad_source_id text,
ADD COLUMN IF NOT EXISTS ad_headline text;
