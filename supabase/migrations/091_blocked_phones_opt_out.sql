-- ============================================================
-- 091_blocked_phones_opt_out.sql
--
-- Fase 5 (Transmissões), Etapa 1 — captura do opt-out de marketing.
--
-- `blocked_phones`: bloqueio chaveado por TELEFONE NORMALIZADO, não
-- por contact_id — sobrevive a um contato apagado e reimportado.
-- `phone_normalized` usa a MESMA expressão já usada em
-- `contacts.phone_normalized` (migration 022_contact_phone_dedup.sql),
-- espelhando normalizePhone() (src/lib/whatsapp/phone-utils.ts), pra
-- que um telefone reimportado normalize pro mesmo valor.
--
-- Histórico preservado em vez de linha única sobrescrita: um bloqueio
-- "ativo" é uma linha com unblocked_at IS NULL; desbloquear marca
-- unblocked_at/unblocked_by/unblock_reason em vez de apagar, e um
-- reboqueio depois disso é uma linha NOVA. O índice único é parcial
-- (só sobre as linhas ativas) pra permitir isso.
--
-- `blocked_by`/`unblocked_by`: uuid solto, sem FK — mesmo padrão já
-- usado em conversations.assigned_agent_id / ticket_events.actor_id
-- (migrations 001/070). Null nas origens automáticas.
--
-- `source`: 'manual' | 'keyword' | 'meta_stop_promotions' |
-- 'cloud_api_error' | 'import'. As 3 automáticas (keyword,
-- meta_stop_promotions, cloud_api_error) são implementadas nesta
-- mesma etapa (código, migration abaixo é só o schema); manual/import
-- ganham UI numa etapa posterior — a coluna já aceita os 5 valores
-- pra não precisar de outra migration só pra isso depois.
--
-- `accounts.broadcast_optout_keywords`: lista configurável por conta
-- das palavras-chave que acionam bloqueio automático na resposta do
-- cliente — seed default SAIR/PARAR/STOP/CANCELAR. Comparação é
-- SEMPRE por mensagem inteira normalizada (minúsculas, sem acento,
-- sem espaço/pontuação nas pontas) — nunca "contém" — para
-- "consigo sair do banco?" não disparar bloqueio por conter "sair".
-- Ver src/lib/whatsapp/opt-out.ts.
--
-- RLS: select = membro da conta; insert/update = admin (mesmo padrão
-- de deal_loss_reasons/contact_statuses) — cobre a futura UI manual.
-- As 3 origens automáticas gravam via supabaseAdmin() (service role),
-- que já bypassa RLS, como todo o resto do webhook.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.blocked_phones (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone text not null,
  phone_normalized text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  source text not null check (source in ('manual', 'keyword', 'meta_stop_promotions', 'cloud_api_error', 'import')),
  reason text,
  blocked_by uuid,
  blocked_at timestamptz not null default now(),
  unblocked_at timestamptz,
  unblocked_by uuid,
  unblock_reason text
);

create index if not exists idx_blocked_phones_account_phone
  on public.blocked_phones(account_id, phone_normalized);

-- Só uma linha ATIVA por telefone por conta — permite re-bloquear
-- depois de um desbloqueio sem violar unicidade.
create unique index if not exists idx_blocked_phones_active_unique
  on public.blocked_phones(account_id, phone_normalized)
  where unblocked_at is null;

alter table public.blocked_phones enable row level security;

drop policy if exists blocked_phones_select on public.blocked_phones;
create policy blocked_phones_select on public.blocked_phones
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists blocked_phones_insert on public.blocked_phones;
create policy blocked_phones_insert on public.blocked_phones
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists blocked_phones_update on public.blocked_phones;
create policy blocked_phones_update on public.blocked_phones
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

alter table public.accounts
  add column if not exists broadcast_optout_keywords text[] not null default array['sair', 'parar', 'stop', 'cancelar'];
