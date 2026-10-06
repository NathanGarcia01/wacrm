-- ============================================================
-- 080_sla_goals.sql
--
-- Fase 3 (dashboards) — Dash de SLA, Etapa 1: metas configuráveis
-- por conta. Uma meta de 1ª resposta e uma de resolução, cada uma em
-- minutos + um modo (24h / horas úteis) independente — uma conta
-- pode querer "1ª resposta em 30min corridos" mas "resolução em 4h
-- úteis", por exemplo.
--
-- Colunas em `accounts` (mesmo padrão aditivo de timezone/
-- tickets_ui_enabled — migrations 069/074), não uma tabela nova:
-- é config de linha única por conta, não um catálogo de linhas
-- (diferente de business_hours, que é uma linha por dia da semana).
--
-- `*_minutes` NULL = meta não configurada/desativada — nunca 0.
-- O front trata null mostrando "—" + aviso pra configurar, mesmo
-- princípio já usado pelo Dash de Atendimento (TMA sem fechamentos).
--
-- RLS: nenhuma policy nova — accounts_update já exige
-- is_account_member(id, 'admin') (migration 017), então só admin+
-- consegue alterar estas colunas automaticamente.
-- ============================================================

alter table public.accounts
  add column if not exists sla_first_response_minutes integer,
  add column if not exists sla_first_response_business_hours boolean not null default false,
  add column if not exists sla_resolution_minutes integer,
  add column if not exists sla_resolution_business_hours boolean not null default false;

alter table public.accounts
  drop constraint if exists accounts_sla_first_response_minutes_positive;
alter table public.accounts
  add constraint accounts_sla_first_response_minutes_positive
    check (sla_first_response_minutes is null or sla_first_response_minutes > 0);

alter table public.accounts
  drop constraint if exists accounts_sla_resolution_minutes_positive;
alter table public.accounts
  add constraint accounts_sla_resolution_minutes_positive
    check (sla_resolution_minutes is null or sla_resolution_minutes > 0);
