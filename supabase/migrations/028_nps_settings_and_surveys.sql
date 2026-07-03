-- ============================================================
-- 028_nps_settings_and_surveys.sql — Post-conversation NPS survey
--
-- `nps_settings` (one row per account) holds the on/off switch, the
-- inactivity threshold, and the two message templates. `nps_surveys`
-- is one row per conversation the survey was sent for — the app
-- layer enforces "never send twice" by checking for an existing row
-- before sending, so there's no unique constraint here beyond the
-- primary key.
--
-- `status` intentionally has only three values (sent / responded /
-- expired), not four. The "rating captured, waiting on an optional
-- comment" moment is represented as status='sent' AND rating IS NOT
-- NULL rather than a dedicated enum value — see
-- src/lib/nps/webhook-handler.ts.
--
-- Written IF NOT EXISTS / idempotently: this schema was already
-- applied directly against the remote project in a prior session,
-- before this migration file existed. Re-running it locally (or on
-- a fresh environment) is safe either way.
-- ============================================================

create table if not exists public.nps_settings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  enabled boolean not null default true,
  inactivity_hours integer not null default 24,
  message_template text not null default 'Olá! Como você avalia o atendimento que recebeu? Responda com um número de 1 a 5, onde 1 = Péssimo e 5 = Excelente. 😊',
  follow_up_message text not null default 'Obrigado pela sua avaliação! Tem algum comentário adicional? (opcional)',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nps_settings enable row level security;

drop policy if exists nps_settings_select on public.nps_settings;
create policy nps_settings_select on public.nps_settings
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists nps_settings_all on public.nps_settings;
create policy nps_settings_all on public.nps_settings
  for all to authenticated
  using (is_account_member(account_id, 'admin'));

create table if not exists public.nps_surveys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  assigned_agent_id uuid,
  sent_at timestamptz not null default now(),
  trigger_type text not null check (trigger_type in ('manual_close', 'inactivity')),
  responded_at timestamptz,
  rating integer check (rating >= 1 and rating <= 5),
  comment text,
  status text not null default 'sent' check (status in ('sent', 'responded', 'expired')),
  created_at timestamptz not null default now()
);

alter table public.nps_surveys enable row level security;

drop policy if exists nps_surveys_select on public.nps_surveys;
create policy nps_surveys_select on public.nps_surveys
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists nps_surveys_insert on public.nps_surveys;
create policy nps_surveys_insert on public.nps_surveys
  for insert to authenticated
  with check (is_account_member(account_id));

drop policy if exists nps_surveys_update on public.nps_surveys;
create policy nps_surveys_update on public.nps_surveys
  for update to authenticated
  using (is_account_member(account_id));

create index if not exists nps_surveys_conversation_id_idx on public.nps_surveys(conversation_id);
create index if not exists nps_surveys_account_status_idx on public.nps_surveys(account_id, status);
