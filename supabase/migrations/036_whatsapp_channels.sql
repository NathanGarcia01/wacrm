-- Formalizes whatsapp_channels as the multi-channel WhatsApp credential
-- store. The table (plus channel_id FKs on conversations/broadcasts)
-- already existed in the live database from a prior session that never
-- landed in a migration file or application code — this migration catches
-- the repo up to that state and extends it with the registration
-- bookkeeping whatsapp_config already had (needed because /register +
-- /subscribed_apps run per phone number). messages.channel_id is added
-- fresh here — conversations/broadcasts got it in that earlier session,
-- messages didn't.
--
-- The drop statements below (whatsapp_numbers / whatsapp_number_id) target
-- a duplicate/unused table from an abandoned earlier attempt at this same
-- feature. It's already gone from the live database as of this writing;
-- they're kept as idempotent no-ops so this migration still applies
-- cleanly against a fresh database or an older snapshot that still has it.

alter table whatsapp_channels
  add column if not exists verify_token text,
  add column if not exists registered_at timestamptz,
  add column if not exists subscribed_apps_at timestamptz,
  add column if not exists last_registration_error text,
  add column if not exists created_by uuid references auth.users(id);

-- Legacy whatsapp_config rows may predate waba_id being required (see the
-- comment in src/app/api/whatsapp/config/route.ts about "legacy rows from
-- before we required it") — relax the constraint to match that reality
-- before backfilling from them.
alter table whatsapp_channels alter column waba_id drop not null;

alter table messages
  add column if not exists channel_id uuid references whatsapp_channels(id) on delete set null;

-- Backfill: give every account with a legacy whatsapp_config row a
-- "Principal" channel. Idempotent on (account_id, phone_number_id), which
-- also happens to be whatsapp_channels' existing unique index.
insert into whatsapp_channels (
  account_id, name, phone_number_id, waba_id, access_token_encrypted,
  is_active, is_default, verify_token, registered_at, subscribed_apps_at,
  last_registration_error, created_by
)
select
  wc.account_id, 'Principal', wc.phone_number_id, wc.waba_id, wc.access_token,
  true, true, wc.verify_token, wc.registered_at, wc.subscribed_apps_at,
  wc.last_registration_error, wc.user_id
from whatsapp_config wc
where not exists (
  select 1 from whatsapp_channels wch
  where wch.account_id = wc.account_id
    and wch.phone_number_id = wc.phone_number_id
);

alter table conversations drop column if exists whatsapp_number_id;
alter table broadcasts drop column if exists whatsapp_number_id;
alter table messages drop column if exists whatsapp_number_id;
drop table if exists whatsapp_numbers;
