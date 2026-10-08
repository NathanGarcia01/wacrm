-- ============================================================
-- 105_message_templates_waba_orphan.sql
--
-- Diagnóstico (conta 2303e920-...): /api/whatsapp/templates/sync só
-- sincronizava a WABA do canal padrão (resolveDefaultChannel), nunca
-- as demais WABAs conectadas — a conta tem 3 canais ativos em 3 WABAs
-- distintas, só 1 delas jamais sincronizada. Em paralelo, 8 templates
-- têm updated_at de 26-27/ago, ANTES do canal padrão atual existir
-- (criado 10/set) — sobras de um canal já desconectado, nunca
-- removidas (a rota de sync explicitamente não apaga sem contrapartida
-- no Meta).
--
-- waba_id: de qual WABA este template veio na última sincronização —
-- null pra templates criados localmente e ainda não submetidos ao
-- Meta (meta_template_id também null nesses casos).
--
-- orphaned: true quando o template tinha meta_template_id mas não
-- apareceu em NENHUMA WABA atualmente conectada na sincronização mais
-- recente — nunca apagado (campanhas antigas podem referenciar o
-- nome), só escondido da lista padrão.
-- ============================================================

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS orphaned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_message_templates_orphaned
  ON public.message_templates(account_id, orphaned);
