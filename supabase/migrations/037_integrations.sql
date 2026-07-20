-- Formalizes `integrations` as the store for external-service connections
-- (Google Sheets first; `type` stays free-form text for future entries
-- like Zapier). The table already existed in the live database from a
-- prior session that never landed in a migration file or application
-- code — this migration catches the repo up to that state. Schema is
-- unchanged from what's live; this is documentation, not a real DDL
-- change.
--
-- `credentials` holds OAuth tokens encrypted at rest (AES-256-GCM, see
-- src/lib/integrations/encryption.ts) — never store them in `config`,
-- which is treated as non-sensitive and may be echoed back to the UI.

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  type text not null, -- 'google_sheets', 'zapier', etc
  config jsonb not null default '{}',
  credentials jsonb not null default '{}', -- tokens criptografados
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, type)
);

comment on table public.integrations is 'Integrações externas por conta: Google Sheets, Zapier, etc. Credenciais armazenadas criptografadas.';

alter table public.integrations enable row level security;

drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations
  for select using (is_account_member(account_id));

drop policy if exists integrations_all on public.integrations;
create policy integrations_all on public.integrations
  for all using (is_account_member(account_id));
