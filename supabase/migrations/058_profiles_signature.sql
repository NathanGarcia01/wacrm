-- ============================================================
-- Adiciona campo de assinatura do atendente em profiles.
--
-- Usado para anexar automaticamente a assinatura (ex: "João Silva
-- - Atendimento Funilly") ao final das mensagens enviadas pelo
-- inbox, quando o toggle de assinatura estiver ativo.
-- ============================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS signature text;
