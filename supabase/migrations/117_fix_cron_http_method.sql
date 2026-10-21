-- Fixes a bug introduced in migration 116: every one of the 6 jobs used
-- net.http_post, but all 6 routes only export a GET handler — every
-- single invocation since scheduling has failed with HTTP 405 (confirmed
-- via net._http_response). Switches to net.http_get and raises the
-- timeout from pg_net's 5s default to 60s, since /api/broadcasts/cron
-- budgets up to 45s per tick (REQUEST_TIME_BUDGET_MS) and a client-side
-- timeout that fires before the server responds is worse than no
-- timeout at all here — same idempotent unschedule-then-recreate
-- pattern as 116.

do $$
declare
  jobs text[][] := array[
    array['funilly-flows-pending', '* * * * *', '/api/flows/pending-cron'],
    array['funilly-flows', '* * * * *', '/api/flows/cron'],
    array['funilly-automations', '* * * * *', '/api/automations/cron'],
    array['funilly-inactivity', '*/5 * * * *', '/api/automations/inactivity-cron'],
    array['funilly-broadcasts', '* * * * *', '/api/broadcasts/cron'],
    array['funilly-nps', '*/15 * * * *', '/api/nps/cron']
  ];
  j text[];
begin
  foreach j slice 1 in array jobs
  loop
    if exists (select 1 from cron.job where jobname = j[1]) then
      perform cron.unschedule(j[1]);
    end if;

    perform cron.schedule(
      j[1],
      j[2],
      format(
        $job$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
          ),
          timeout_milliseconds := 60000
        );
        $job$,
        'https://www.funilly.tech' || j[3]
      )
    );
  end loop;
end $$;
