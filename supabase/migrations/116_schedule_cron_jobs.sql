-- Permanently schedules the 6 cron routes via pg_cron + pg_net, reading
-- the shared secret from Supabase Vault (name 'cron_secret') rather than
-- embedding it here. Idempotent: each job is unscheduled first if it
-- already exists under the same name, then recreated.
--
-- Context: pg_cron had never been enabled on this project, so none of
-- these routes had ever run in production despite existing in the repo
-- for months (see project memory: flows cron never scheduled incident).

do $$
declare
  job record;
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
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
          )
        );
        $job$,
        'https://www.funilly.tech' || j[3]
      )
    );
  end loop;
end $$;
