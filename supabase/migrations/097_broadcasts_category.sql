-- ============================================================
-- 097_broadcasts_category.sql
--
-- Fase 5 (Transmissões), Etapa 3 — broadcasts.category
-- ('marketing' | 'utility' | 'authentication'), lowercase (message_
-- templates.category itself is 'Marketing'/'Utility'/'Authentication',
-- Meta's own casing — lowercased here only, kept as-is at the source).
--
-- Set going forward at creation time (src/hooks/use-broadcast-
-- sending.ts, from the template row already in hand — no extra
-- query). Backfilled here for every existing broadcast via
-- (account_id, template_name, template_language) → message_templates.
--
-- Backfill result (checked in a rolled-back dry run before applying):
-- 56 broadcasts total, 56 backfilled, 0 left null — every existing
-- broadcast's (account_id, template_name, language) still resolves to
-- a live message_templates row, so none were left uncategorized.
-- Nullable column: a FUTURE broadcast could still end up without a
-- category if its template is deleted from message_templates before
-- the backfill-equivalent logic runs — not possible today, but the
-- column stays nullable rather than NOT NULL so that can never hard-fail
-- a write.
--
-- Idempotent — safe to run multiple times (backfill only touches rows
-- where category IS NULL).
-- ============================================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS category text CHECK (category IN ('marketing', 'utility', 'authentication'));

UPDATE public.broadcasts b
SET category = lower(mt.category)
FROM public.message_templates mt
WHERE mt.account_id = b.account_id
  AND mt.name = b.template_name
  AND mt.language = coalesce(b.template_language, 'en_US')
  AND b.category IS NULL;
