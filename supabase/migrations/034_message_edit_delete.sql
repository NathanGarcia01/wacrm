-- ============================================================
-- Local (CRM-only) message edit + delete.
--
-- Meta's Cloud API has no endpoint to edit a message once sent, so
-- editing is CRM-side only: rewrites `content_text` in place and
-- stamps `edited_at`. Deleting attempts a best-effort DELETE against
-- Meta first (see /api/whatsapp/delete-message and
-- lib/whatsapp/meta-api.ts's deleteWhatsAppMessage) — not every
-- message is eligible on Meta's side (age, type, delivery state) — and
-- ALWAYS stamps `deleted_at` locally regardless of Meta's response
-- (soft delete — content_text is kept in the row, just hidden behind
-- the deleted_at check in the UI, which renders a "[Mensagem apagada]"
-- placeholder instead). If Meta didn't confirm the deletion, the
-- customer's own WhatsApp app may still show the original message —
-- the UI surfaces that as a warning rather than pretending it always
-- succeeds.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
