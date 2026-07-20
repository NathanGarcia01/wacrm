-- Real-time push side of the Google Sheets integration. `deals` is
-- written directly by the client via supabase-js (deal-form.tsx,
-- pipeline-board.tsx) — there is no single API route all writes pass
-- through. A DB trigger is the only choke point that sees every write
-- regardless of origin (client, automations engine, a future CSV
-- import), so this fires an async HTTP call into the app instead of
-- relying on every call site remembering to invoke the sync route.
--
-- pg_net dispatches from a background worker *after* the triggering
-- transaction commits, so the sync route can safely re-SELECT the deal
-- by id for INSERT/UPDATE. For DELETE the row is already gone by the
-- time the HTTP call lands — the route only needs the id to remove the
-- matching row from the sheet, never the deal's data.
create extension if not exists pg_net;

-- Shared secret the sync route checks via the `x-cron-secret` header
-- (same header name/pattern as AUTOMATION_CRON_SECRET elsewhere), kept
-- in Vault rather than inlined here so it never sits in plaintext in a
-- migration file that's checked into git. Generated once; re-running
-- this migration leaves an existing secret untouched.
-- Raw `insert into vault.secrets` fails under the role this migration
-- runs as (permission denied inside pgsodium's encryption trigger);
-- `vault.create_secret()` is SECURITY DEFINER and works from the same
-- role, so use it instead.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'google_sheets_sync_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'google_sheets_sync_secret',
      'shared secret for google sheets sync webhook'
    );
  end if;
end $$;

create or replace function public.notify_google_sheets_sync()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
  -- Single fixed deployment (see CLAUDE.md) — no per-environment
  -- config table exists yet for a value this narrow in scope.
  v_base_url constant text := 'https://wacrm-uhnw.onrender.com';
  v_account_id uuid;
  v_deal_id uuid;
begin
  if tg_op = 'DELETE' then
    v_account_id := old.account_id;
    v_deal_id := old.id;
  else
    v_account_id := new.account_id;
    v_deal_id := new.id;
  end if;

  -- Cheap short-circuit: skip the HTTP round-trip entirely for the
  -- (typical) account that has never connected Google Sheets.
  if not exists (
    select 1 from public.integrations
    where account_id = v_account_id
      and type = 'google_sheets'
      and is_active
  ) then
    return coalesce(new, old);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'google_sheets_sync_secret';

  if v_secret is null then
    return coalesce(new, old);
  end if;

  perform net.http_post(
    url := v_base_url || '/api/integrations/google-sheets/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'deal_id', v_deal_id,
      'account_id', v_account_id,
      'op', tg_op
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists deals_google_sheets_sync on public.deals;
create trigger deals_google_sheets_sync
  after insert or update or delete on public.deals
  for each row execute function public.notify_google_sheets_sync();
