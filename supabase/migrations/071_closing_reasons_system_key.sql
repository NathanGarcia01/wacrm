-- ============================================================
-- 071_closing_reasons_system_key.sql
--
-- Fase 1 (atendimento) — Etapa 4, regra 5 aprovada: até a Etapa 6 ter
-- a tela de fechamento com motivo obrigatório, todo caminho que hoje
-- fecha uma conversa sem pedir motivo (UI manual, automações, fluxos)
-- precisa de ALGUM closing_reason_id para satisfazer a CHECK de
-- tickets (migration 070) — ela não aceita status='closed' sem um.
--
-- Migration 069 só previa UM motivo de sistema por conta
-- ("Encerrado por inatividade", is_system=true) e um índice único
-- parcial (account_id) WHERE is_system garantindo isso. Precisamos de
-- um SEGUNDO motivo de sistema ("Encerrado (sem motivo informado)")
-- para esse placeholder de transição — o índice antigo bloquearia.
--
-- system_key identifica QUAL motivo de sistema é cada linha, mesmo
-- padrão que `plans.code` já usa neste schema para lookup estável por
-- código em vez de casar por texto do label (que pode mudar). O
-- índice único passa a ser por (account_id, system_key).
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

alter table public.closing_reasons
  add column if not exists system_key text;

drop index if exists idx_closing_reasons_one_system_per_account;

create unique index if not exists idx_closing_reasons_one_system_key_per_account
  on public.closing_reasons(account_id, system_key) where is_system;

-- Backfill: a linha de sistema seedada pela 069 não tinha system_key —
-- ela é sempre a de inatividade (era a única que existia).
update public.closing_reasons
  set system_key = 'inactivity'
  where is_system and system_key is null;

-- handle_new_user() (migrations 017, 050, 051, 069) passa a seedar os
-- DOIS motivos de sistema. Corpo idêntico ao de 069_attendance_catalog.sql
-- + system_key nos dois INSERTs + o INSERT novo.
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

  insert into public.closing_reasons (account_id, label, is_system, system_key, position)
  values
    (v_account_id, 'Encerrado por inatividade', true, 'inactivity', 0),
    (v_account_id, 'Encerrado (sem motivo informado)', true, 'no_reason_informed', 1);

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

-- Backfill — contas já existentes recebem o motivo "sem motivo
-- informado" agora (a de inatividade já foi seedada pela 069).
insert into public.closing_reasons (account_id, label, is_system, system_key, position)
select a.id, 'Encerrado (sem motivo informado)', true, 'no_reason_informed', 1
from public.accounts a
where not exists (
  select 1 from public.closing_reasons cr
  where cr.account_id = a.id and cr.is_system and cr.system_key = 'no_reason_informed'
);
