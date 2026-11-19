-- ============================================================
-- 136_optout_keywords_audit_log.sql
--
-- Fase 2 (Radar) — produto: bloqueio de opt-out passa a ser
-- incondicional em todo lugar que envia (ver commit que acompanha
-- esta migration: broadcasts/cron, use-broadcast-sending,
-- marketing-template-guard deixam de depender de
-- accounts.broadcast_optout_enforced). Esse campo passa a controlar
-- SÓ a resposta automática de confirmação/VOLTAR — não renomeado
-- nesta migration (só a semântica em código/UI), proposta de rename
-- em separado.
--
-- optout_keywords_audit_log: toda vez que um admin edita
-- accounts.broadcast_optout_keywords pela tela (rota
-- /api/settings/opt-out/keywords), uma linha é gravada aqui — quem,
-- quando, lista antes e depois. RLS: SELECT para admin+ (mesma
-- visibilidade de routing_assignment_events); SEM policy de escrita
-- para `authenticated` — mesmo padrão de toda tabela de auditoria
-- desta base (migration 129/133): só a rota, via supabaseAdmin(),
-- grava.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

create table if not exists public.optout_keywords_audit_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Referencia profiles.user_id por convenção, sem FK de banco —
  -- mesmo padrão de tickets.assigned_agent_id/ticket_events.actor_id.
  changed_by uuid not null,
  keywords_before text[] not null,
  keywords_after text[] not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_optout_keywords_audit_log_account_created
  on public.optout_keywords_audit_log(account_id, created_at);

alter table public.optout_keywords_audit_log enable row level security;

drop policy if exists optout_keywords_audit_log_select on public.optout_keywords_audit_log;
create policy optout_keywords_audit_log_select on public.optout_keywords_audit_log
  for select to authenticated
  using (is_account_member(account_id, 'admin'));

comment on column public.accounts.broadcast_optout_enforced is
  'Controla SÓ a resposta automática de confirmação/VOLTAR ao capturar um opt-out (keyword ou botão SAIR/NÃO SOU A PESSOA). NÃO controla se o bloqueio é respeitado no envio — isso é incondicional para toda conta (ver isPhoneBlocked em broadcasts/cron, use-broadcast-sending, marketing-template-guard). Nome do campo ficou desatualizado de propósito; renomear é uma migration separada.';
