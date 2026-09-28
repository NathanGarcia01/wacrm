-- ============================================================
-- 066_whatsapp_embedded_signup_sessions.sql
--
-- Ephemeral holding table for the Meta Embedded Signup OAuth popup
-- flow. The callback route exchanges the OAuth code for a long-lived
-- Meta access token and fetches the account's WABAs/phone numbers,
-- but can't hand the token to the browser (URL query strings show up
-- in history/logs, and a business can have more WABAs/numbers than
-- comfortably fit in a query string anyway). Instead it stores both
-- here and redirects the popup to /whatsapp-connect?session=<id>,
-- which reads the WABA/number list (never the token itself) via a
-- follow-up API call, and the final "complete" step reads the token
-- server-side to actually create the whatsapp_channels row.
--
-- Rows are short-lived (10 minutes) and access is service-role only —
-- RLS is enabled with zero policies, matching the "deny everyone but
-- the server" intent, since a leaked long-lived Meta token here is as
-- sensitive as one already stored in whatsapp_channels.
-- ============================================================

create table if not exists public.whatsapp_embedded_signup_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  long_lived_token_encrypted text not null,
  wabas jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists whatsapp_embedded_signup_sessions_account_id_idx
  on public.whatsapp_embedded_signup_sessions(account_id);

alter table public.whatsapp_embedded_signup_sessions enable row level security;
