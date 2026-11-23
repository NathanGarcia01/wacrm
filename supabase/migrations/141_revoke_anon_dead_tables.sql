-- ============================================================
-- 141_revoke_anon_dead_tables.sql
--
-- Hardening de grants do role `anon` em tabelas antigas (fora das
-- Fases 1/2/3A, já endurecidas na migration 140).
--
-- Auditoria (2026-11-23): ~63 tabelas em `public` têm GRANT pra
-- `anon` (o padrão de privilégio do projeto concede ALL em toda
-- tabela nova pra `anon`/`authenticated`, ver migration 140). Pra
-- cada uma, verificamos duas coisas:
--   (a) existe alguma RLS policy que cite o role `anon` ou `public`?
--   (b) algum componente client-side (`@/lib/supabase/client`, a
--       chave anon rodando no navegador) consulta essa tabela?
--
-- 33 tabelas têm policy citando `anon`/`public` — NÃO tocadas aqui
-- (contacts, deals, conversations, messages, tags, pipelines,
-- profiles, accounts, subscriptions, plans, api_keys, automations,
-- flows, broadcasts, integrations, whatsapp_config, custom_fields,
-- message_templates, contact_notes, contact_tags,
-- contact_custom_values, deal_tasks, automation_steps, flow_nodes,
-- flow_runs, flow_run_events, message_reactions, member_presence,
-- account_invitations, rsvp_pedro — essa última é uma tabela isolada
-- sem relação com o CRM, também fora de escopo). A policy "public"
-- na prática ainda exige `auth.uid()` via `is_account_member`/
-- `auth.uid() = ...` — anon nunca teria uma sessão válida — mas como
-- ELAS TÊM policy citando o role, ficam fora do critério definido
-- pra esta migration (não confundir "tem policy pro role" com
-- "está de fato aberta pra anon").
--
-- Das 30 tabelas sem nenhuma policy pra anon/public, 20 são
-- consultadas por componentes client-side (`@/lib/supabase/client`)
-- — mas em todos os casos, dentro de telas que só existem atrás do
-- login (`(dashboard)/...`, `settings/*`, `inbox/*`, `pipelines/*`);
-- nenhuma página pública (login, signup, /precos, /join/[token],
-- forgot/reset-password, termos, privacidade) toca tabela nenhuma
-- diretamente — tudo ali passa por rota de API server-side. Mesmo
-- assim, por terem uso do cliente anon em algum arquivo do código
-- (2º critério pedido), ficam de fora desta migration: account_user_
-- sales_goals, blocked_phones, business_hours, closing_reasons,
-- contact_statuses, conversation_notes, deal_events,
-- deal_loss_reasons, deal_products, department_members, departments,
-- holidays, lead_origins, nps_settings, nps_surveys, product_catalog,
-- quick_replies, ticket_events, tickets, whatsapp_channels.
--
-- As 10 tabelas restantes — sem policy pra anon/public E sem
-- nenhuma referência em código client-side (só tocadas por rotas
-- server-side/cron via supabaseAdmin()) — têm o GRANT ALL de `anon`
-- revogado aqui: account_ticket_counters, admin_users,
-- automation_pending_executions, cron_locks, flow_pending_executions,
-- meta_pricing, mrr_snapshots, password_reset_tokens,
-- subscription_events, whatsapp_embedded_signup_sessions.
--
-- Nada do role `authenticated` ou `service_role` é tocado aqui.
--
-- REVERSÃO (restaura o grant original, ALL, em cada uma das 10):
--
--   grant all on table public.account_ticket_counters to anon;
--   grant all on table public.admin_users to anon;
--   grant all on table public.automation_pending_executions to anon;
--   grant all on table public.cron_locks to anon;
--   grant all on table public.flow_pending_executions to anon;
--   grant all on table public.meta_pricing to anon;
--   grant all on table public.mrr_snapshots to anon;
--   grant all on table public.password_reset_tokens to anon;
--   grant all on table public.subscription_events to anon;
--   grant all on table public.whatsapp_embedded_signup_sessions to anon;
--
-- Idempotente — REVOKE não erra se o privilégio já não existir;
-- seguro rodar mais de uma vez.
-- ============================================================

revoke all on table public.account_ticket_counters from anon;
revoke all on table public.admin_users from anon;
revoke all on table public.automation_pending_executions from anon;
revoke all on table public.cron_locks from anon;
revoke all on table public.flow_pending_executions from anon;
revoke all on table public.meta_pricing from anon;
revoke all on table public.mrr_snapshots from anon;
revoke all on table public.password_reset_tokens from anon;
revoke all on table public.subscription_events from anon;
revoke all on table public.whatsapp_embedded_signup_sessions from anon;
