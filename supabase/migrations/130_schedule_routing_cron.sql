-- ============================================================
-- 130_schedule_routing_cron.sql
--
-- Fase 1 (distribuição automática de tickets) — Etapa 2: agenda o
-- ciclo de atribuição automática (/api/routing/cron) via pg_cron,
-- mesmo padrão idempotente de 116/117 (unschedule-then-recreate,
-- net.http_get, secret do Vault 'cron_secret' no header
-- x-cron-secret). A cada minuto, mesma cadência de
-- funilly-flows/funilly-automations/funilly-broadcasts — a fila de
-- tickets pendentes deve ser esvaziada rápido, não em lotes de 15min
-- como o NPS.
-- ============================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'funilly-routing') then
    perform cron.unschedule('funilly-routing');
  end if;

  perform cron.schedule(
    'funilly-routing',
    '* * * * *',
    $job$
    select net.http_get(
      url := 'https://www.funilly.tech/api/routing/cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    );
    $job$
  );
end $$;
