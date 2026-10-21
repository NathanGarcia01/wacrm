-- Enables the permanent pg_cron scheduling of the 6 cron routes and closes
-- two idempotency gaps found while wiring it up (see project memory:
-- flows cron never scheduled incident).
--
-- pg_net was already enabled; pg_cron is enabled in a separate prior
-- migration (enable_pg_cron_extension) applied directly via the dashboard
-- migration tool.

-- ---------------------------------------------------------------------
-- 1. Whole-route mutex for the two crons that had no per-row claim
--    (/api/automations/inactivity-cron, /api/nps/cron). Every other cron
--    route already claims its rows atomically (status transition or
--    next_batch_at push into the future) before acting on them, so an
--    overlapping invocation can't double-process — these two lacked that
--    and relied only on a check-then-act SELECT, which races under
--    concurrent invocations (slow previous tick + a new one firing).
-- ---------------------------------------------------------------------
create table if not exists public.cron_locks (
  job_name text primary key,
  locked_until timestamptz not null
);

create or replace function public.try_acquire_cron_lock(p_job_name text, p_ttl_seconds int)
returns boolean
language plpgsql
as $$
declare
  v_acquired boolean;
begin
  insert into public.cron_locks (job_name, locked_until)
  values (p_job_name, now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (job_name) do update
    set locked_until = excluded.locked_until
    where public.cron_locks.locked_until < now()
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. NPS survey send was check-then-act with the WhatsApp send happening
--    BEFORE the dedup row was inserted (src/lib/nps/send-survey.ts) — two
--    concurrent cron ticks could both pass the "already sent in the last
--    24h" check and both actually send the message. This RPC turns the
--    claim into one atomic statement (serialized per account+contact via
--    an advisory xact lock, released when the call's implicit transaction
--    ends) so only one caller ever gets a non-null id back.
-- ---------------------------------------------------------------------
alter table public.nps_surveys drop constraint if exists nps_surveys_status_check;
alter table public.nps_surveys add constraint nps_surveys_status_check
  check (status in ('sent', 'responded', 'expired', 'sending', 'failed'));

create or replace function public.claim_nps_survey_slot(
  p_account_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_assigned_agent_id uuid,
  p_trigger_type text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_account_id::text || ':' || p_contact_id::text));

  insert into public.nps_surveys (
    account_id, contact_id, conversation_id, assigned_agent_id, trigger_type, status, sent_at
  )
  select p_account_id, p_contact_id, p_conversation_id, p_assigned_agent_id, p_trigger_type, 'sending', now()
  where not exists (
    select 1 from public.nps_surveys
    where account_id = p_account_id
      and contact_id = p_contact_id
      and status in ('sent', 'responded', 'sending')
      and sent_at >= now() - interval '24 hours'
  )
  returning id into v_id;

  return v_id;
end;
$$;
