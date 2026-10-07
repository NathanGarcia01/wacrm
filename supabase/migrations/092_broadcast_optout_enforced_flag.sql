-- ============================================================
-- 092_broadcast_optout_enforced_flag.sql
--
-- Fase 5 (Transmissões) — accounts.broadcast_optout_enforced,
-- default false. Originally planned for a later etapa ("aplicação no
-- envio"), brought forward here because it's needed NOW to gate the
-- opt-out confirmation/VOLTAR reply introduced in Etapa 1: without
-- this flag, every account's customers were getting a WhatsApp
-- message claiming "você não vai mais receber nossas campanhas" even
-- though nothing is filtering sends for that account yet — a lie.
--
-- Capture (inserting into blocked_phones) stays unconditional for
-- every account, as originally decided — only the outbound reply and
-- (later etapa) the actual send-time exclusion are gated on this.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS broadcast_optout_enforced boolean NOT NULL DEFAULT false;
