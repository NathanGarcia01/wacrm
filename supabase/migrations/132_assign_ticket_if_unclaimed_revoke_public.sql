-- ============================================================
-- 132_assign_ticket_if_unclaimed_revoke_public.sql
--
-- Fase 1 (distribuição automática de tickets) — hardening: o
-- Supabase advisor (security lint) apontou que
-- assign_ticket_if_unclaimed (migration 131) é executável por
-- `anon` e `authenticated` via /rest/v1/rpc, porque toda função
-- nova recebe EXECUTE para PUBLIC por padrão no Postgres — o
-- `grant ... to service_role` da migration 131 nunca revogou isso.
-- Mesma lição do incidente de RLS de 2026-10-16: um GRANT para
-- PUBLIC sobrevive a qualquer REVOKE em roles nomeadas que não
-- inclua PUBLIC explicitamente.
--
-- A função já se protege em runtime (raise exception quando
-- auth.role() <> 'service_role', igual a next_ticket_protocol —
-- migration 070), então isto não era explorável; fechado aqui por
-- princípio, não por uma falha ativa.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

revoke all on function public.assign_ticket_if_unclaimed(uuid, uuid) from public;
revoke all on function public.assign_ticket_if_unclaimed(uuid, uuid) from anon, authenticated;
grant execute on function public.assign_ticket_if_unclaimed(uuid, uuid) to service_role;
