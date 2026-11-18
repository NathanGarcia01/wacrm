-- ============================================================
-- 129_routing_settings.sql
--
-- Fase 1 (distribuição automática de tickets) — Etapa 2: schema para
-- o modo de atribuição por conta, capacidade/participação por membro
-- e a auditoria de atribuições automáticas. A lógica de decisão
-- (src/lib/routing/decide.ts) e o ciclo (src/lib/routing/cycle.ts)
-- entram no mesmo commit, mas são código, não schema.
--
-- RLS ligado em todas as três tabelas, mas SEM policy de INSERT/
-- UPDATE/DELETE para `authenticated` — mesmo padrão de
-- account_ticket_counters (migration 070): toda escrita passa por
-- rota server-side via supabaseAdmin() (service_role bypassa RLS),
-- nunca por escrita direta do client. A rota valida admin+ e o plano
-- (hasRouting) antes de chamar o service-role client.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- routing_settings — um modo por conta. enabled_at marca o instante
-- em que o modo deixou de ser 'manual' pela última vez; o ciclo
-- (cycle.ts) só considera tickets com opened_at > enabled_at, então
-- nunca redistribui o backlog que já existia antes de a distribuição
-- automática ser ligada (ou religada, depois de ter sido desligada).
-- ------------------------------------------------------------
create table if not exists public.routing_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  mode text not null default 'manual'
    check (mode in ('manual', 'round_robin', 'load')),
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.routing_settings enable row level security;

drop policy if exists routing_settings_select on public.routing_settings;
create policy routing_settings_select on public.routing_settings
  for select to authenticated
  using (is_account_member(account_id));

-- ------------------------------------------------------------
-- routing_member_settings — capacidade (máximo de tickets
-- in_progress simultâneos) e participação (is_enabled) por membro.
-- Membro sem linha aqui usa o default da aplicação (capacidade 5,
-- habilitado) — ver DEFAULT_CAPACITY/DEFAULT_IS_ENABLED em
-- src/lib/routing/cycle.ts.
-- ------------------------------------------------------------
create table if not exists public.routing_member_settings (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  capacity integer not null default 5 check (capacity >= 1),
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

alter table public.routing_member_settings enable row level security;

drop policy if exists routing_member_settings_select on public.routing_member_settings;
create policy routing_member_settings_select on public.routing_member_settings
  for select to authenticated
  using (is_account_member(account_id));

-- ------------------------------------------------------------
-- routing_assignment_events — auditoria append-only de toda
-- atribuição feita pelo ciclo automático (atribuição manual pela UI
-- continua só em ticket_events, via assignTicket). Índice
-- (account_id, agent_id, created_at) suporta a leitura de
-- "lastAssignedAt por agente" que o rodízio faz a cada execução do
-- ciclo.
-- ------------------------------------------------------------
create table if not exists public.routing_assignment_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  -- Bare uuid, sem FK — mesma convenção de tickets.assigned_agent_id:
  -- referencia profiles.user_id, mas não é uma foreign key de banco.
  agent_id uuid not null,
  mode text not null check (mode in ('round_robin', 'load')),
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_routing_assignment_events_account_agent_created
  on public.routing_assignment_events(account_id, agent_id, created_at);

create index if not exists idx_routing_assignment_events_ticket
  on public.routing_assignment_events(ticket_id);

alter table public.routing_assignment_events enable row level security;

-- Auditoria visível só para admin+ (owner/admin) — agentes não veem
-- a trilha de decisão de outros agentes.
drop policy if exists routing_assignment_events_select on public.routing_assignment_events;
create policy routing_assignment_events_select on public.routing_assignment_events
  for select to authenticated
  using (is_account_member(account_id, 'admin'));
