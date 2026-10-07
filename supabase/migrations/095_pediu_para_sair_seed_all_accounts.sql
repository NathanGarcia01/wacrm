-- ============================================================
-- 095_pediu_para_sair_seed_all_accounts.sql
--
-- Fase 5, Etapa 7 — o motivo de perda "Pediu para sair" (migration
-- 090) só existia na conta 2303e920-c4a9-4224-a13d-7b81e5634813. Essa
-- migration: (1) semeia esse mesmo rótulo, idempotente, em toda conta
-- que ainda não o tem; (2) estende handle_new_user() pra que toda
-- conta nova já nasça com ele — preservando TODO o corpo atual da
-- função, só acrescentando um insert novo antes do `return new;`.
--
-- Position: coalesce(max(position)+1, 0) por conta, pra nunca colidir
-- com motivos que a conta já tenha (a conta Nathan já tem 9: posições
-- 0-9 vindas das migrations 049/090).
--
-- Idempotente: insert usa ON CONFLICT no índice único já existente
-- (account_id, lower(label)) — migration 049 — então re-rodar é
-- no-op; handle_new_user() via CREATE OR REPLACE também é
-- idempotente.
-- ============================================================

INSERT INTO public.deal_loss_reasons (account_id, label, position)
SELECT a.id, 'Pediu para sair',
  (SELECT COALESCE(MAX(dl.position) + 1, 0) FROM public.deal_loss_reasons dl WHERE dl.account_id = a.id)
FROM public.accounts a
ON CONFLICT (account_id, lower(label)) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  insert into public.tags (user_id, account_id, name, color)
  values
    (new.id, v_account_id, 'Ativo', '#22c55e'),
    (new.id, v_account_id, 'Receptivo', '#60a5fa'),
    (new.id, v_account_id, 'Orgânico', '#a78bfa'),
    (new.id, v_account_id, 'Via Anúncio Meta', '#f59e0b');

  -- Fase 5, Etapa 7 — motivo de perda padrão ligado ao bloqueio de
  -- marketing (opcional, UI de bloqueio): toda conta nova já nasce
  -- com "Pediu para sair" no catálogo de deal_loss_reasons.
  insert into public.deal_loss_reasons (account_id, label, position)
  values (v_account_id, 'Pediu para sair', 0);

  return new;
exception
  when unique_violation then
    raise exception 'duplicate_document' using errcode = 'unique_violation';
  when others then
    raise warning 'Failed to bootstrap account/profile/subscription for user %: %', new.id, sqlerrm;
    return new;
end;
$function$;
