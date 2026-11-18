-- ============================================================
-- 134_is_contact_opted_out_search_path.sql
--
-- Fase 2 (Radar) — hardening: o advisor apontou is_contact_opted_out
-- (migration 133) sem `set search_path`, mesmo lint de
-- function_search_path_mutable que já existia para outras 15 funções
-- pré-existentes (não corrigidas aqui, fora do escopo desta tarefa).
-- Toda referência dentro do corpo já é esquematizada (public.xxx),
-- então não era explorável, mas fechado por consistência com o
-- padrão das outras funções desta migration (get_radar_conversations
-- já tinha `set search_path = public`).
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
  )
  or exists (
    select 1
    from public.broadcast_recipients br
    join public.broadcasts b on b.id = br.broadcast_id
    where b.account_id = p_account_id
      and br.contact_id = p_contact_id
      and upper(trim(coalesce(br.button_clicked, ''))) in ('SAIR', 'NAO SOU A PESSOA', 'NÃO SOU A PESSOA')
  );
$$;

revoke all on function public.is_contact_opted_out(uuid, uuid) from public;
revoke all on function public.is_contact_opted_out(uuid, uuid) from anon, authenticated;
grant execute on function public.is_contact_opted_out(uuid, uuid) to service_role;
