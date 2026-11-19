-- ============================================================
-- 137_followup.sql
--
-- Fase 2 (Radar + Follow-up seguro) — Etapa B, B1 (segurança).
-- Schema completo da feature de uma vez (B2/B3 só passam a LER/
-- aplicar algumas destas colunas — ver followup_settings.max_per_day,
-- por exemplo — mas o schema todo entra agora pra não fatiar
-- migrations por etapa de código).
--
-- Três peças novas + uma correção num gap de segurança real:
--
--   1. followup_dispatch_log — auditoria append-only E fonte de
--      contagem de "tentativas por conversa" (B2) e teto diário por
--      conta (B2). Uma "tentativa" = UMA linha com outcome='sent' por
--      disparo do follow-up (não por passo de envio dentro da
--      automation/flow — ver engine.ts/workflow-engine.ts no mesmo
--      commit). `automation_id`/`flow_id` podem ser os DOIS null
--      (ex.: contato opted-out detectado ANTES de saber qual
--      automation/flow dispararia) mas nunca os dois preenchidos.
--
--   2. followup_settings — teto diário configurável por conta
--      (lido só a partir de B2; a tabela já existe desde B1 pra não
--      fatiar schema).
--
--   3. inactivity_scan_cursor — pagination por keyset
--      (last_message_at, id) pra o cron de inatividade ciclar por
--      TODA conversa parada ao longo de vários ticks, em vez de ficar
--      presa reavaliando sempre as mesmas 100 mais antigas pra sempre
--      (dedup evita reenvio, mas NUNCA tirava a conversa da
--      varredura — a 101ª conversa parada de uma conta nunca era
--      vista enquanto as 100 mais antigas continuassem existindo).
--
--   4. Status 'cancelled' em automation_pending_executions e
--      flow_pending_executions — hoje, se o cliente responde OU entra
--      em opt-out enquanto uma automation/flow de inatividade está
--      num `wait` step/node, NADA cancela essa espera:
--      resumePendingExecution (automations/cron) e
--      resumePendingWorkflowExecution (flows/pending-cron) despacham
--      o passo seguinte (ex. send_message) ignorando que a conversa
--      mudou de estado enquanto esperava. Confirmado lendo o webhook
--      por completo: ele nunca toca essas duas tabelas. O status novo
--      dá uma saída limpa — os dois crons de resume já filtram
--      `WHERE status='pending'`, então uma linha 'cancelled' some da
--      fila sem precisar mexer em mais nada além de quem cancela
--      (cancelPendingInactivityFollowups, mesmo commit).
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

create table if not exists public.followup_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  flow_id uuid references public.flows(id) on delete set null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  outcome text not null check (outcome in ('sent', 'skipped')),
  reason text,
  -- 'live' conta pra max_attempts/max_per_day (B2); 'dry_run' nunca
  -- conta pra nenhum teto — só existe pra relatório manual (B3).
  mode text not null default 'live' check (mode in ('live', 'dry_run')),
  created_at timestamptz not null default now(),
  check (automation_id is null or flow_id is null)
);

create index if not exists idx_followup_dispatch_log_conversation_outcome
  on public.followup_dispatch_log(conversation_id, outcome, mode, created_at);
create index if not exists idx_followup_dispatch_log_account_created
  on public.followup_dispatch_log(account_id, created_at);

alter table public.followup_dispatch_log enable row level security;

drop policy if exists followup_dispatch_log_select on public.followup_dispatch_log;
create policy followup_dispatch_log_select on public.followup_dispatch_log
  for select to authenticated
  using (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
create table if not exists public.followup_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  max_per_day integer not null default 50 check (max_per_day > 0),
  updated_at timestamptz not null default now()
);

alter table public.followup_settings enable row level security;

drop policy if exists followup_settings_select on public.followup_settings;
create policy followup_settings_select on public.followup_settings
  for select to authenticated
  using (is_account_member(account_id));

-- ------------------------------------------------------------
-- RLS ligado, SEM policy nenhuma — só o cron (service_role) toca,
-- mesmo padrão de account_ticket_counters (migration 070).
create table if not exists public.inactivity_scan_cursor (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_seen_last_message_at timestamptz,
  last_seen_conversation_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.inactivity_scan_cursor enable row level security;

-- ------------------------------------------------------------
alter table public.automation_pending_executions
  drop constraint if exists automation_pending_executions_status_check;
alter table public.automation_pending_executions
  add constraint automation_pending_executions_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'cancelled'));

alter table public.flow_pending_executions
  drop constraint if exists flow_pending_executions_status_check;
alter table public.flow_pending_executions
  add constraint flow_pending_executions_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'cancelled'));
