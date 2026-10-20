-- ============================================================
-- Broadcast template variables: header/button mappings + error_code.
--
-- Context: broadcast "SANTANA [HIGIENIZAÇÃO 2] [1]" (and others) sent
-- template parameters built from `broadcasts.template_variables`
-- (e.g. {{1}} = contact field "name") straight to Meta with no
-- fallback — a contact with no name produced an EMPTY body
-- parameter, which Meta rejects with "(#131008) Required parameter
-- is missing". Per-variable defaults now ride inside
-- `template_variables` itself (each VariableMapping gained an
-- optional `default` key — see src/lib/broadcast-variables.ts), so no
-- schema change was needed for that part.
--
-- This migration adds the two pieces that DO need real columns:
--
--   1. header_variable / button_variables — until now the broadcast
--      wizard only ever collected BODY variables. A template whose
--      header has a text variable, or whose URL button has a dynamic
--      {{1}} suffix, had no way to supply a value — the cron would
--      either throw (text header) or skip the button component
--      entirely (template-send-builder.ts). These two JSONB columns
--      store a VariableMapping for the header text placeholder and a
--      map of button-index → VariableMapping for dynamic URL buttons.
--
--   2. broadcast_recipients.error_code — Meta's numeric error code
--      (e.g. 131008), parsed once at send time from MetaApiError and
--      persisted alongside the existing raw error_message text. Lets
--      the UI translate the code to PT-BR reliably (rather than
--      regex-parsing the message every render) and lets "Reenviar
--      falhas" target exactly the recipients that failed with a
--      specific code (131008) instead of every failure.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_variable JSONB,
  ADD COLUMN IF NOT EXISTS button_variables JSONB;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS error_code INTEGER;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_error_code
  ON broadcast_recipients(broadcast_id, error_code)
  WHERE error_code IS NOT NULL;
