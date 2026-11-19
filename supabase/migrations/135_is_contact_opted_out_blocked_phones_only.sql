-- ============================================================
-- 135_is_contact_opted_out_blocked_phones_only.sql
--
-- Fase 2 (Radar) — simplificação pós-backfill: is_contact_opted_out
-- (migration 133/134) checava DUAS fontes — blocked_phones ativo OU
-- clique em botão "SAIR"/"NÃO SOU A PESSOA" em broadcast_recipients —
-- porque até aqui um clique de botão nunca gravava blocked_phones
-- (bug corrigido no commit f48ebcd: handleOptOutButtonTap). Com o fix
-- em produção (confirmado deployado) E o backfill dos 499 contatos já
-- aplicado (499 linhas em blocked_phones, todas account_id =
-- 2303e920, source='import', verificado por SELECT antes de dar
-- commit), a segunda fonte ficou redundante: todo opt-out por botão —
-- passado (backfill) e futuro (fix no webhook) — já está em
-- blocked_phones.
--
-- Medido (produção, conta 2303e920, consulta do Radar):
--   antes (2 EXISTS, pós-backfill): 644ms
--   depois (1 EXISTS, só blocked_phones): 13ms  (~49x)
-- Elimina o join com broadcast_recipients/broadcasts inteiramente —
-- melhor que o índice parcial avaliado antes (476ms), que foi
-- descartado em favor desta simplificação.
--
-- Mesma assinatura (uuid, uuid) returns boolean, mesmo EXECUTE restrito
-- a service_role (migration 134) — reafirmado aqui por
-- defesa-em-profundidade, não porque CREATE OR REPLACE FUNCTION altere
-- privilégios (não altera).
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

create or replace function public.is_contact_opted_out(
  p_account_id uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.blocked_phones bp
    join public.contacts ct on ct.phone_normalized = bp.phone_normalized
    where bp.account_id = p_account_id
      and ct.id = p_contact_id
      and bp.unblocked_at is null
  );
$$;

revoke all on function public.is_contact_opted_out(uuid, uuid) from public;
revoke all on function public.is_contact_opted_out(uuid, uuid) from anon, authenticated;
grant execute on function public.is_contact_opted_out(uuid, uuid) to service_role;
