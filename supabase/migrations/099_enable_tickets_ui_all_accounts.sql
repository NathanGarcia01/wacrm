-- ============================================================
-- 099_enable_tickets_ui_all_accounts.sql
--
-- Decisão: libera a nova UI de atendimento (Fase 1) para TODAS as
-- contas. Muda o DEFAULT de accounts.tickets_ui_enabled pra true
-- (contas novas já nascem com ela ativa — handle_new_user() não
-- referencia essa coluna em lugar nenhum, então o DEFAULT sozinho já
-- resolve, sem precisar tocar na função) e ativa em toda conta
-- existente.
--
-- Checagem de risco feita ANTES de aplicar (ver relatório da
-- conversa): nenhuma conta tem 0 motivos de fechamento não-sistema —
-- toda conta carrega os 5 custom seedados por handle_new_user(). 13
-- das 14 contas não têm canal de WhatsApp ativo nem membro além do
-- dono (uma delas, "claude-browser-test-...", nem tem o dono — 0
-- profiles, anomalia de dados pré-existente e não relacionada a este
-- rollout). Nenhuma conta tem departamento cadastrado, incluindo a
-- que já usa a UI em produção — confirma que department_id nulo é
-- caminho normal, não quebra nada. Separadamente, TICKETS_ENABLED
-- (env var, src/lib/tickets/flags.ts) continua sendo o kill switch
-- global dos efeitos de ticket — não alterado por esta migration.
--
-- Testado em transação com rollback: as 14 contas existentes foram
-- pra true (0 ficaram false); um INSERT sintético em auth.users
-- disparou handle_new_user() de verdade e a conta nova nasceu com
-- tickets_ui_enabled=true, só pelo novo DEFAULT.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

ALTER TABLE public.accounts ALTER COLUMN tickets_ui_enabled SET DEFAULT true;

UPDATE public.accounts
SET tickets_ui_enabled = true
WHERE tickets_ui_enabled IS DISTINCT FROM true;
