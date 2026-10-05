-- ============================================================
-- 074_tickets_ui_rollout.sql
--
-- Fase 1 (atendimento) — Etapa 6: infraestrutura pra ligar a UI de
-- tickets na inbox conta por conta.
--
-- accounts.tickets_ui_enabled — feature flag por conta. Com false
-- (default), a inbox continua exatamente como está hoje (abas por
-- conversations.status, header com os botões antigos de atribuir/
-- fechar). O rollout é manual: liga-se uma conta por vez direto no
-- banco, sem deploy, até a Etapa 6 estar validada em produção.
--
-- tickets na publicação supabase_realtime — sem isso a aba de
-- tickets (contadores, status, protocolo) nunca recebe update em
-- tempo real; é o mesmo mecanismo que messages/conversations já
-- usam desde a 001, só que RLS-scoped (tickets_select exige
-- is_account_member, migration 070) — Realtime respeita essa policy
-- por conexão, então um evento só chega pra quem já teria permissão
-- de SELECT na linha.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

alter table public.accounts
  add column if not exists tickets_ui_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table tickets;
  end if;
end $$;
