-- ============================================================
-- 096_enable_optout_enforcement_nathan_account.sql
--
-- Fase 5, Etapa 8 — liga a aplicação do bloqueio de marketing nos
-- disparos (accounts.broadcast_optout_enforced) para a conta
-- 2303e920-c4a9-4224-a13d-7b81e5634813. A partir de agora, pra essa
-- conta: a confirmação automática por palavra-chave/VOLTAR passa a
-- ser enviada de verdade, novos disparos excluem bloqueados na
-- criação e a cada envio, e send_template de categoria Marketing em
-- automações/fluxos respeita o bloqueio. Captura (gravar o bloqueio)
-- já era incondicional desde a Etapa 1 — isso não muda.
--
-- Scoped to this single account only.
-- ============================================================

UPDATE public.accounts
SET broadcast_optout_enforced = true
WHERE id = '2303e920-c4a9-4224-a13d-7b81e5634813';
