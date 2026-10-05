-- ============================================================
-- 073_closing_reasons_seed_defaults.sql
--
-- Fase 1 (atendimento) — Etapa 7: a tela de cadastro de Motivos de
-- Fechamento (Settings → Atendimento) precisa de algo pra mostrar
-- além dos dois motivos de sistema (069/071) — e o futuro modal de
-- fechamento obrigatório (Etapa 6) precisa de motivos reais pro
-- agente escolher. Seeda 5 motivos não-sistema por conta:
-- "Venda realizada", "Sem interesse", "Dúvida resolvida", "Contato
-- errado", "Outros".
--
-- Não-sistema (is_system=false) de propósito — aparecem editáveis/
-- excluíveis na tela nova, diferente dos dois motivos de sistema que
-- a UI (e a RLS) bloqueiam. position começa em 2 (0 e 1 já são dos
-- motivos de sistema seedados por handle_new_user, ver 071).
--
-- Idempotente — tanto o backfill quanto handle_new_user guardam
-- contra o índice único (account_id, lower(label)) de
-- idx_closing_reasons_account_label (migration 069): se a conta já
-- tiver um motivo com aquele label (ex.: um admin já criou "Outros"
-- manualmente antes desta migration rodar), o INSERT daquele label
-- específico é pulado, não o lote inteiro.
-- ============================================================

-- handle_new_user() (migrations 017, 050, 051, 069, 071) passa a
-- seedar também os 5 motivos padrão pra contas novas. Corpo idêntico
-- ao de 071_closing_reasons_system_key.sql + os 5 INSERTs novos.
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

  insert into public.closing_reasons (account_id, label, is_system, position)
  values
    (v_account_id, 'Venda realizada', false, 2),
    (v_account_id, 'Sem interesse', false, 3),
    (v_account_id, 'Dúvida resolvida', false, 4),
    (v_account_id, 'Contato errado', false, 5),
    (v_account_id, 'Outros', false, 6);

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

-- Backfill — contas já existentes recebem os 5 motivos padrão agora,
-- um de cada vez, pulando qualquer label que a conta já tenha
-- (case-insensitive, mesma regra do índice único).
insert into public.closing_reasons (account_id, label, is_system, position)
select a.id, v.label, false, v.position
from public.accounts a
cross join (
  values
    ('Venda realizada', 2),
    ('Sem interesse', 3),
    ('Dúvida resolvida', 4),
    ('Contato errado', 5),
    ('Outros', 6)
) as v(label, position)
where not exists (
  select 1 from public.closing_reasons cr
  where cr.account_id = a.id and lower(cr.label) = lower(v.label)
);
