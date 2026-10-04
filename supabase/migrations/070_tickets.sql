-- ============================================================
-- 070_tickets.sql
--
-- Fase 1 (atendimento) — Etapa 2: a entidade de ticket em si, mais o
-- protocolo sequencial por conta e o log de eventos. A lógica de
-- ciclo de vida (quando abrir, quando preencher first_response_at,
-- como fechar) entra na Etapa 3 — esta migration só cria schema,
-- RLS e índices.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- account_ticket_counters — contador atômico por conta para gerar o
-- protocol_number sequencial. Sem precedente no schema (nenhuma outra
-- entidade tem numeração sequencial por conta) — padrão novo.
--
-- RLS ligado e SEM policies, mesmo padrão de
-- whatsapp_embedded_signup_sessions (migration 066): nenhum client
-- autenticado deve ler ou escrever aqui diretamente, só a função
-- next_ticket_protocol() abaixo (SECURITY DEFINER, roda como o
-- owner da função — bypassa RLS independente de policy).
-- ------------------------------------------------------------
create table if not exists public.account_ticket_counters (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_number bigint not null default 0
);

alter table public.account_ticket_counters enable row level security;

-- Atômico: o UPDATE dentro do ON CONFLICT toma lock de linha no
-- account_id, então duas chamadas concorrentes para a mesma conta
-- serializam naturalmente — a segunda só lê o valor já incrementado
-- pela primeira. Não precisa de advisory lock explícito.
create or replace function public.next_ticket_protocol(p_account_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  -- auth.role() = 'service_role' covers the webhook/cron paths, which
  -- call this via supabaseAdmin() with no signed-in user — auth.uid()
  -- is null there, so is_account_member() alone would wrongly reject
  -- them (service_role bypasses RLS on tables automatically, but this
  -- check is procedural code, not a policy, so it needs its own
  -- explicit bypass).
  if auth.role() <> 'service_role' and not is_account_member(p_account_id, 'agent') then
    raise exception 'forbidden';
  end if;

  insert into public.account_ticket_counters (account_id, last_number)
  values (p_account_id, 1)
  on conflict (account_id) do update
    set last_number = account_ticket_counters.last_number + 1
  returning last_number into v_next;

  return v_next;
end;
$$;

alter function public.next_ticket_protocol(uuid) owner to postgres;
grant execute on function public.next_ticket_protocol(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- tickets — um atendimento. Uma `conversations` row pode ter várias
-- tickets ao longo do tempo (uma por ciclo aberto→fechado); o índice
-- único parcial abaixo garante que só uma delas fica "em aberto" por
-- vez por conversa, mesmo sob concorrência (webhook e send route
-- podem disputar a criação ao mesmo tempo).
--
-- source/initiated_by/campaign_id (combinado aprovado antes da
-- Etapa 2): envio de campanha ou automação nunca abre ticket por si
-- só — só quando o contato responde. Nesse momento:
--   - veio de uma campanha recente  → source='campaign', campaign_id preenchido
--   - veio de um envio de automação → source='automation'
--   - contato chegou organicamente  → source='inbound'
--   - agente mandou a 1ª mensagem   → source='manual_outbound', initiated_by='company'
-- "campaign" aqui é a tabela `broadcasts` desta base — não existe uma
-- tabela `campaigns` separada.
--
-- closed_by é só o "quem" (agente vs. job de sistema); closing_reason_id
-- é o "por quê" — a 2ª CHECK abaixo torna motivo obrigatório em todo
-- fechamento (agente ou sistema) no nível do banco, não só na UI.
-- ------------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  protocol_number bigint not null,

  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'closed')),

  initiated_by text not null
    check (initiated_by in ('customer', 'company')),

  source text not null
    check (source in ('inbound', 'manual_outbound', 'campaign', 'automation')),

  -- FK para broadcasts(id) — ver nota acima sobre nomenclatura.
  campaign_id uuid references public.broadcasts(id) on delete set null,

  -- Bare uuid, sem FK — mesmo padrão de conversations.assigned_agent_id
  -- (001_initial_schema.sql): referencia profiles.user_id por
  -- convenção, não por constraint.
  assigned_agent_id uuid,

  department_id uuid references public.departments(id) on delete set null,

  opened_at timestamptz not null default now(),
  first_response_at timestamptz,
  closed_at timestamptz,

  -- Sem ON DELETE SET NULL de propósito: um motivo em uso não pode
  -- ser apagado (ficaria RESTRICT, o default) — o catálogo usa
  -- is_active para "retirar" um motivo sem destruir o histórico de
  -- quem fechou com ele.
  closing_reason_id uuid references public.closing_reasons(id),
  closing_note text,
  closed_by text check (closed_by in ('agent', 'system')),

  created_at timestamptz not null default now(),

  check (campaign_id is null or source = 'campaign'),
  check (
    (source = 'manual_outbound' and initiated_by = 'company')
    or (source in ('inbound', 'campaign', 'automation') and initiated_by = 'customer')
  ),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'closed') = (closed_by is not null)),
  check ((status = 'closed') = (closing_reason_id is not null))
);

create unique index if not exists idx_tickets_account_protocol
  on public.tickets(account_id, protocol_number);

-- A trava de concorrência do plano: no máximo um ticket não-fechado
-- por conversa.
create unique index if not exists idx_tickets_conversation_open
  on public.tickets(conversation_id) where status <> 'closed';

create index if not exists idx_tickets_conversation on public.tickets(conversation_id);
create index if not exists idx_tickets_account_status on public.tickets(account_id, status);
create index if not exists idx_tickets_account_agent_opened
  on public.tickets(account_id, assigned_agent_id, opened_at);
create index if not exists idx_tickets_account_department_opened
  on public.tickets(account_id, department_id, opened_at);

alter table public.tickets enable row level security;

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (is_account_member(account_id, 'agent'));

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (is_account_member(account_id, 'agent'));

-- Sem policy de DELETE — tickets são histórico de atendimento e não
-- devem ser apagáveis por nenhum role de client (só service_role,
-- que ignora RLS, em uma eventual limpeza administrativa futura).

-- ------------------------------------------------------------
-- ticket_events — log append-only de toda mudança de ticket. A
-- Etapa 3 (lifecycle lib) é quem efetivamente grava um evento a cada
-- ação; esta migration só prepara a tabela.
-- ------------------------------------------------------------
create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,

  type text not null
    check (type in ('opened', 'assigned', 'transferred', 'returned', 'closed', 'reopened')),

  from_agent_id uuid,
  to_agent_id uuid,
  from_department_id uuid references public.departments(id) on delete set null,
  to_department_id uuid references public.departments(id) on delete set null,

  -- Null = ação do sistema (ex.: futuro job de auto-fechamento), não
  -- de um usuário autenticado.
  actor_id uuid,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_events_account_created
  on public.ticket_events(account_id, created_at);
create index if not exists idx_ticket_events_ticket on public.ticket_events(ticket_id);

alter table public.ticket_events enable row level security;

drop policy if exists ticket_events_select on public.ticket_events;
create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (is_account_member(account_id));

-- Sem policy de INSERT para `authenticated` — só o servidor (service_role,
-- que ignora RLS) grava eventos. A Etapa 3 (lifecycle lib) é o único
-- lugar que deve inserir aqui; nenhum client autenticado escreve
-- ticket_events diretamente.
drop policy if exists ticket_events_insert on public.ticket_events;

-- Sem policy de UPDATE/DELETE — log de auditoria é append-only.
