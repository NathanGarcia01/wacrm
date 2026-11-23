-- ============================================================
-- 140_harden_grants_fase1_2_3a.sql
--
-- Hardening de grants — tabelas novas das Fases 1 (routing), 2
-- (radar/follow-up) e 3A (lead sources).
--
-- Achado: toda tabela nova no schema `public` herda, por padrão do
-- projeto Supabase (ALTER DEFAULT PRIVILEGES configurado fora das
-- migrations), GRANT ALL (SELECT/INSERT/UPDATE/DELETE/...) para
-- `anon` e `authenticated` — mesmo quando a única policy de RLS da
-- tabela é um SELECT escopado por `is_account_member`. O RLS já
-- bloqueia o acesso indevido hoje (nenhuma policy de INSERT/UPDATE/
-- DELETE existe pra `authenticated`, e `anon` não tem policy
-- nenhuma), mas a concessão de privilégio continua "ligada" — defesa
-- em profundidade incompleta, mesmo princípio do incidente de RLS
-- registrado em 2026-10-16 (ccb888a), agora aplicado a GRANTs de
-- tabela em vez de GRANTs de função.
--
-- Escopo: só as tabelas criadas nas Fases 1/2/3A (migrations 129,
-- 133, 136, 137, 139). Tabelas mais antigas têm o mesmo padrão de
-- grant (achado confirmado por auditoria, ver resumo da conversa) mas
-- NÃO são tocadas aqui — risco e escopo de uma mudança em massa em
-- todo o schema ficam fora desta migration.
--
-- Regra aplicada, tabela a tabela:
--   - `anon`: REVOKE ALL. Nenhuma dessas tabelas é lida por caller
--     anônimo — o único acesso público (webhook de lead) passa por
--     supabaseAdmin()/service_role, que ignora GRANT e RLS.
--   - `authenticated`: REVOKE ALL, depois GRANT SELECT apenas nas
--     tabelas que de fato têm uma policy de SELECT pra esse role
--     (routing_settings, routing_member_settings,
--     routing_assignment_events, radar_settings,
--     optout_keywords_audit_log, followup_dispatch_log,
--     followup_settings, lead_sources, lead_source_events). A
--     escrita nessas tabelas é sempre via supabaseAdmin() nas rotas
--     server-side — nenhuma delas tem policy de INSERT/UPDATE/DELETE
--     pra `authenticated` de propósito.
--   - `inactivity_scan_cursor` é a única exceção: zero policies de
--     RLS (achado "RLS Enabled No Policy" do advisor) — é um cursor
--     interno do cron de inatividade, nunca lido/escrito por um
--     usuário autenticado. REVOKE ALL de `anon` e `authenticated`,
--     sem GRANT de volta pra nenhum dos dois.
--
-- Idempotente — REVOKE/GRANT não erram se o privilégio já não
-- existir/já existir; seguro rodar mais de uma vez.
-- ============================================================

revoke all on table public.routing_settings from anon, authenticated;
grant select on table public.routing_settings to authenticated;

revoke all on table public.routing_member_settings from anon, authenticated;
grant select on table public.routing_member_settings to authenticated;

revoke all on table public.routing_assignment_events from anon, authenticated;
grant select on table public.routing_assignment_events to authenticated;

revoke all on table public.radar_settings from anon, authenticated;
grant select on table public.radar_settings to authenticated;

revoke all on table public.optout_keywords_audit_log from anon, authenticated;
grant select on table public.optout_keywords_audit_log to authenticated;

revoke all on table public.followup_dispatch_log from anon, authenticated;
grant select on table public.followup_dispatch_log to authenticated;

revoke all on table public.followup_settings from anon, authenticated;
grant select on table public.followup_settings to authenticated;

revoke all on table public.lead_sources from anon, authenticated;
grant select on table public.lead_sources to authenticated;

revoke all on table public.lead_source_events from anon, authenticated;
grant select on table public.lead_source_events to authenticated;

-- No RLS policy at all (any role, any command) — no grant back.
revoke all on table public.inactivity_scan_cursor from anon, authenticated;
