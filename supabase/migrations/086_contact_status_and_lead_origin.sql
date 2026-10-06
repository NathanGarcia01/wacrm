-- ============================================================
-- 086_contact_status_and_lead_origin.sql
--
-- Fase 4, Etapa 3 — dois catálogos novos, mesma forma:
-- `contact_statuses` ("Status do cliente" — Novo/Em negociação/
-- Cliente/Inativo etc.) e `lead_origins` ("Origens do lead" —
-- indicação, feira, site, prospecção fria... o que o sistema NÃO
-- detecta automaticamente).
--
-- Diferente do motivo de perda (migration 084), aqui o FK de
-- `contacts` usa `ON DELETE SET NULL`, não RESTRICT: status/origem
-- são um rótulo do AGORA, não o registro histórico de um evento já
-- fechado — não faz sentido travar a exclusão de um status só
-- porque um contato está nele hoje.
--
-- "Origens do lead" NÃO substitui nada que já existe:
--   - A atribuição automática por anúncio Meta (contacts.ad_source_id
--     e companhia, migrations 067/068) continua exatamente como
--     está — é proveniência real, não cabe num catálogo editável.
--   - A tagueação informal do webhook ("Ativo"/"Receptivo"/
--     "Orgânico"/"Via Anúncio Meta", via ensureContactTagByName() em
--     src/lib/contacts/auto-tag.ts) também continua como está nesta
--     etapa — só ganha SEED de verdade agora (abaixo), já que hoje
--     essas 4 tags não existem em nenhuma conta até alguém criar à
--     mão com o nome exato certo. Migrar o webhook pra gravar
--     `lead_origin_id` em vez de tag por nome fica pra depois
--     (decisão em aberto já registrada no plano da Fase 4).
--
-- Seed das 4 tags de origem automática:
--   1. Backfill idempotente pra toda conta JÁ EXISTENTE — sem
--      constraint UNIQUE em tags(account_id, lower(name)) pra usar
--      ON CONFLICT, então o idempotente aqui é um
--      `where not exists (...)` por conta+nome.
--   2. `handle_new_user()` ganha as mesmas 4 inserções pra toda conta
--      NOVA — corpo da função preservado integralmente, só acrescenta
--      um bloco de insert antes do `return new`. Conta nova nunca tem
--      tag própria ainda, então não precisa do mesmo guard
--      `not exists` do backfill (mas não faz mal ter).
-- ============================================================

create table if not exists public.contact_statuses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label text not null,
  color text not null default '#3b82f6',
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_contact_statuses_account on public.contact_statuses(account_id);
create unique index if not exists idx_contact_statuses_account_label
  on public.contact_statuses(account_id, lower(label));

alter table public.contact_statuses enable row level security;

drop policy if exists contact_statuses_select on public.contact_statuses;
create policy contact_statuses_select on public.contact_statuses
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists contact_statuses_insert on public.contact_statuses;
create policy contact_statuses_insert on public.contact_statuses
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists contact_statuses_update on public.contact_statuses;
create policy contact_statuses_update on public.contact_statuses
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists contact_statuses_delete on public.contact_statuses;
create policy contact_statuses_delete on public.contact_statuses
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

create table if not exists public.lead_origins (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label text not null,
  color text not null default '#3b82f6',
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_origins_account on public.lead_origins(account_id);
create unique index if not exists idx_lead_origins_account_label
  on public.lead_origins(account_id, lower(label));

alter table public.lead_origins enable row level security;

drop policy if exists lead_origins_select on public.lead_origins;
create policy lead_origins_select on public.lead_origins
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists lead_origins_insert on public.lead_origins;
create policy lead_origins_insert on public.lead_origins
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists lead_origins_update on public.lead_origins;
create policy lead_origins_update on public.lead_origins
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists lead_origins_delete on public.lead_origins;
create policy lead_origins_delete on public.lead_origins
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

alter table public.contacts
  add column if not exists status_id uuid references public.contact_statuses(id) on delete set null,
  add column if not exists lead_origin_id uuid references public.lead_origins(id) on delete set null;

create index if not exists idx_contacts_account_status on public.contacts(account_id, status_id);
create index if not exists idx_contacts_account_lead_origin on public.contacts(account_id, lead_origin_id);

-- ------------------------------------------------------------
-- Seed das 4 tags de origem automática — contas existentes.
-- ------------------------------------------------------------
insert into public.tags (user_id, account_id, name, color)
select a.owner_user_id, a.id, v.name, v.color
from public.accounts a
cross join (
  values
    ('Ativo', '#22c55e'),
    ('Receptivo', '#60a5fa'),
    ('Orgânico', '#a78bfa'),
    ('Via Anúncio Meta', '#f59e0b')
) as v(name, color)
where not exists (
  select 1 from public.tags t
  where t.account_id = a.id and lower(t.name) = lower(v.name)
);

-- ------------------------------------------------------------
-- handle_new_user() — corpo integralmente preservado, só acrescenta
-- o seed das mesmas 4 tags antes do `return new`.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.closing_reasons (account_id, label, is_system, position)
  values
    (v_account_id, 'Venda realizada', false, 2),
    (v_account_id, 'Sem interesse', false, 3),
    (v_account_id, 'Dúvida resolvida', false, 4),
    (v_account_id, 'Contato errado', false, 5),
    (v_account_id, 'Outros', false, 6);

  -- Fase 4, Etapa 3 (migration 086): mesmas 4 tags de origem
  -- automática que o webhook já tenta linkar por nome
  -- (ensureContactTagByName(), src/lib/contacts/auto-tag.ts) — sem
  -- isto, toda conta nova nascia sem elas até alguém criar à mão.
  insert into public.tags (user_id, account_id, name, color)
  values
    (new.id, v_account_id, 'Ativo', '#22c55e'),
    (new.id, v_account_id, 'Receptivo', '#60a5fa'),
    (new.id, v_account_id, 'Orgânico', '#a78bfa'),
    (new.id, v_account_id, 'Via Anúncio Meta', '#f59e0b');

  return new;
exception
  when unique_violation then
    raise exception 'duplicate_document' using errcode = 'unique_violation';
  when others then
    raise warning 'Failed to bootstrap account/profile/subscription for user %: %', new.id, sqlerrm;
    return new;
end;
$function$;
