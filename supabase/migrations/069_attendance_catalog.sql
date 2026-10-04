-- ============================================================
-- 069_attendance_catalog.sql
--
-- Fase 1 (atendimento) — Etapa 1: tabelas de cadastro usadas pelo
-- futuro ticket de atendimento (migration seguinte), mas que não
-- dependem dele: departamentos, motivos de fechamento, horário de
-- atendimento e feriados. Nenhuma coluna é adicionada em
-- `conversations` nesta migration — só catálogo novo.
--
-- Mesmo padrão de RLS de 049_deal_loss_reasons.sql /
-- 030_product_catalog_and_commission.sql: leitura para qualquer
-- membro da conta, escrita restrita a admin+.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- accounts.timezone — horário de atendimento é definido em horas de
-- parede ("08:00–18:00"), então precisa de um fuso por conta para
-- converter em instantes reais. Até aqui o único "horário comercial"
-- do sistema era o hardcoded de respect_business_hours nas
-- transmissões (src/lib/broadcast-cadence.ts), fixo em
-- America/Sao_Paulo — mantém o mesmo default aqui para não mudar
-- comportamento de ninguém no primeiro deploy.
-- ------------------------------------------------------------
alter table public.accounts
  add column if not exists timezone text not null default 'America/Sao_Paulo';

-- ------------------------------------------------------------
-- departments — filas de atendimento. is_active permite "desativar"
-- um departamento sem apagar o histórico de tickets que apontam
-- para ele (FK fica em restrict/no-action implícito do default).
-- ------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_departments_account on public.departments(account_id);

create unique index if not exists idx_departments_account_name
  on public.departments(account_id, lower(name));

alter table public.departments enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists departments_delete on public.departments;
create policy departments_delete on public.departments
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- department_members — quem atende em cada fila. Join table sem
-- account_id próprio (mesmo padrão de contact_tags em
-- 017_account_sharing.sql): RLS verifica a conta via o department
-- pai.
-- ------------------------------------------------------------
create table if not exists public.department_members (
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (department_id, user_id)
);

create index if not exists idx_department_members_user on public.department_members(user_id);

alter table public.department_members enable row level security;

drop policy if exists department_members_select on public.department_members;
create policy department_members_select on public.department_members
  for select to authenticated
  using (
    exists (
      select 1 from public.departments d
      where d.id = department_members.department_id
        and is_account_member(d.account_id)
    )
  );

drop policy if exists department_members_insert on public.department_members;
create policy department_members_insert on public.department_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.departments d
      where d.id = department_members.department_id
        and is_account_member(d.account_id, 'admin')
    )
  );

drop policy if exists department_members_delete on public.department_members;
create policy department_members_delete on public.department_members
  for delete to authenticated
  using (
    exists (
      select 1 from public.departments d
      where d.id = department_members.department_id
        and is_account_member(d.account_id, 'admin')
    )
  );

-- ------------------------------------------------------------
-- closing_reasons — motivos de fechamento de ticket. is_system marca
-- o motivo seedado automaticamente ("Encerrado por inatividade",
-- usado pelo futuro job de auto-fechamento) — a policy de
-- update/delete abaixo bloqueia edição/remoção dessas linhas mesmo
-- para admin, então a imutabilidade é garantida no banco, não só na
-- UI. O unique index parcial garante no máximo um motivo de sistema
-- por conta.
-- ------------------------------------------------------------
create table if not exists public.closing_reasons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label text not null,
  position integer not null default 0,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_closing_reasons_account on public.closing_reasons(account_id);

create unique index if not exists idx_closing_reasons_account_label
  on public.closing_reasons(account_id, lower(label));

create unique index if not exists idx_closing_reasons_one_system_per_account
  on public.closing_reasons(account_id) where is_system;

alter table public.closing_reasons enable row level security;

drop policy if exists closing_reasons_select on public.closing_reasons;
create policy closing_reasons_select on public.closing_reasons
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists closing_reasons_insert on public.closing_reasons;
create policy closing_reasons_insert on public.closing_reasons
  for insert to authenticated
  with check (is_account_member(account_id, 'admin') and not is_system);

drop policy if exists closing_reasons_update on public.closing_reasons;
create policy closing_reasons_update on public.closing_reasons
  for update to authenticated
  using (is_account_member(account_id, 'admin') and not is_system);

drop policy if exists closing_reasons_delete on public.closing_reasons;
create policy closing_reasons_delete on public.closing_reasons
  for delete to authenticated
  using (is_account_member(account_id, 'admin') and not is_system);

-- ------------------------------------------------------------
-- business_hours — uma linha por janela de atendimento num dia da
-- semana. weekday segue a convenção de Date#getDay() do JS (0 =
-- domingo .. 6 = sábado), já que quem lê/escreve isso é sempre
-- código TS. Mais de uma linha por weekday é permitido de propósito
-- (ex.: 08:00–12:00 e 13:00–18:00 para almoço) — só bloqueia range
-- duplicado exato.
-- ------------------------------------------------------------
create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists idx_business_hours_account_weekday on public.business_hours(account_id, weekday);

create unique index if not exists idx_business_hours_account_weekday_range
  on public.business_hours(account_id, weekday, start_time, end_time);

alter table public.business_hours enable row level security;

drop policy if exists business_hours_select on public.business_hours;
create policy business_hours_select on public.business_hours
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists business_hours_insert on public.business_hours;
create policy business_hours_insert on public.business_hours
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists business_hours_update on public.business_hours;
create policy business_hours_update on public.business_hours
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists business_hours_delete on public.business_hours;
create policy business_hours_delete on public.business_hours
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- holidays — datas soltas (sem recorrência anual) em que o horário
-- de atendimento não vale.
-- ------------------------------------------------------------
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  label text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_holidays_account_date on public.holidays(account_id, date);

alter table public.holidays enable row level security;

drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists holidays_insert on public.holidays;
create policy holidays_insert on public.holidays
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists holidays_update on public.holidays;
create policy holidays_update on public.holidays
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists holidays_delete on public.holidays;
create policy holidays_delete on public.holidays
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- handle_new_user() (migrations 017, 050, 051) passa a seedar o
-- motivo de fechamento de sistema junto com account/profile/
-- subscription — mesma transação, mesma regra de "falha aqui não
-- derruba o signup" (WHEN OTHERS do bloco original). Corpo idêntico
-- ao de 051_account_document.sql + o INSERT novo.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_account_id uuid;
  v_starter_plan_id uuid;
  v_document text;
  v_document_type text;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_document := nullif(new.raw_user_meta_data->>'document', '');
  v_document_type := nullif(new.raw_user_meta_data->>'document_type', '');

  insert into public.accounts (name, owner_user_id, document, document_type)
  values (coalesce(nullif(v_full_name, ''), new.email, 'My account'), new.id, v_document, v_document_type)
  returning id into v_account_id;

  insert into public.profiles (user_id, full_name, email, account_id, account_role)
  values (new.id, v_full_name, new.email, v_account_id, 'owner');

  select id into v_starter_plan_id from public.plans where code = 'starter' limit 1;

  if v_starter_plan_id is not null then
    insert into public.subscriptions (account_id, plan_id, status, seats, trial_start, trial_end)
    values (v_account_id, v_starter_plan_id, 'trialing', 1, now(), now() + interval '7 days');
  end if;

  insert into public.closing_reasons (account_id, label, is_system, position)
  values (v_account_id, 'Encerrado por inatividade', true, 0);

  return new;
exception
  when unique_violation then
    raise exception 'duplicate_document' using errcode = 'unique_violation';
  when others then
    raise warning 'Failed to bootstrap account/profile/subscription for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;

-- Backfill — contas já existentes recebem o motivo de sistema agora.
insert into public.closing_reasons (account_id, label, is_system, position)
select a.id, 'Encerrado por inatividade', true, 0
from public.accounts a
where not exists (
  select 1 from public.closing_reasons cr
  where cr.account_id = a.id and cr.is_system
);
