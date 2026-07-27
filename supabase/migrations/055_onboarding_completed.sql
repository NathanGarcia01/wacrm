-- ============================================================
-- Tour de onboarding interativo — controla se o usuário já viu (ou
-- pulou) o tour guiado que roda automaticamente no primeiro login.
-- Por usuário (não por conta), já que cada membro de uma conta
-- compartilhada pode logar pela primeira vez em momentos diferentes.
-- ============================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
