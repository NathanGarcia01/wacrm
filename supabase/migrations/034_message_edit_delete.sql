-- ============================================================
-- Local (CRM-only) message edit + delete.
--
-- The WhatsApp Cloud API has no endpoint to edit or delete a message
-- once sent — confirmed against the official Meta docs and multiple
-- third-party references. So this is intentionally CRM-side only:
-- editing rewrites `content_text` in place and stamps `edited_at`;
-- "deleting" stamps `deleted_at` (soft delete — content_text is kept
-- in the row, just hidden behind the deleted_at check in the UI) and
-- the bubble renders a "[Mensagem apagada]" placeholder instead. The
-- customer's own WhatsApp app is never touched and still shows the
-- original message — the UI must make that clear.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
