-- ============================================================
-- 059_conversations_reopened_at.sql — track conversation reopen events
--
-- This CRM keeps exactly one `conversations` row per (account, contact)
-- forever — findOrCreateConversation() reuses the existing row rather
-- than creating a new one, and a closed conversation just flips back to
-- status='open' on a fresh inbound message (see the webhook routes).
--
-- That means conversation_id alone can't distinguish "the customer's
-- first attendance" from "the customer came back weeks later after we
-- closed things out" — both share the same row. `reopened_at` marks the
-- most recent closed→open transition so NPS dedup logic (see
-- src/lib/nps/send-survey.ts) can scope "already surveyed" to the
-- current attendance period instead of the conversation's entire
-- lifetime.
-- ============================================================

alter table public.conversations
  add column if not exists reopened_at timestamptz;
