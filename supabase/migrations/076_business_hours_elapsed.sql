-- ============================================================
-- 076_business_hours_elapsed.sql
--
-- Fase 3 (dashboards) — Etapa 1: tempo decorrido contado só dentro
-- do horário de atendimento (business_hours), no fuso da conta,
-- pulando feriados (holidays). Base para TMA e tempo de primeira
-- resposta nos próximos passos da Fase 3 — ainda não usada por
-- nenhum dashboard.
--
-- Conta sem business_hours cadastrado: devolve o tempo corrido
-- (p_end - p_start) sem filtrar nada — cabe ao dashboard checar
-- `exists(select 1 from business_hours where account_id = ...)`
-- separadamente pra decidir se avisa "horário de atendimento não
-- configurado" (esta função não devolve esse aviso, só o número).
--
-- Eficiência: um laço por dia corrido entre p_start e p_end (não por
-- minuto) — pra um ticket aberto por N dias, no máximo N iterações,
-- cada uma com um select indexado (account_id, weekday) em
-- business_hours e um lookup por (account_id, date) em holidays.
--
-- STABLE + SECURITY INVOKER: só leitura, sem efeito colateral, sem
-- precisar escalar privilégio — quem chama já precisa ser membro da
-- conta pra ter acesso de leitura a tickets/conversations via RLS, e
-- as mesmas policies de business_hours/holidays (is_account_member)
-- já se aplicam normalmente como invoker.
-- ============================================================

create or replace function public.business_hours_elapsed(
  p_account_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns interval
language plpgsql
stable
security invoker
as $$
declare
  v_tz text;
  v_has_hours boolean;
  v_start_date date;
  v_end_date date;
  v_day date;
  v_bh record;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_overlap_start timestamptz;
  v_overlap_end timestamptz;
  v_total interval := interval '0';
begin
  -- Caso 8: fim antes do início — zero, nunca negativo.
  if p_end <= p_start then
    return interval '0';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  -- Caso 7: conta sem horário cadastrado — tempo corrido.
  select exists(
    select 1 from public.business_hours where account_id = p_account_id
  ) into v_has_hours;

  if not v_has_hours then
    return p_end - p_start;
  end if;

  v_start_date := (p_start at time zone v_tz)::date;
  v_end_date := (p_end at time zone v_tz)::date;

  for v_day in
    select generate_series(v_start_date, v_end_date, interval '1 day')::date
  loop
    -- Caso 5: feriado no meio do intervalo — pula o dia inteiro.
    if exists (
      select 1 from public.holidays
      where account_id = p_account_id and date = v_day
    ) then
      continue;
    end if;

    for v_bh in
      select start_time, end_time
      from public.business_hours
      where account_id = p_account_id
        and weekday = extract(dow from v_day)::smallint
    loop
      v_window_start := (v_day + v_bh.start_time) at time zone v_tz;
      v_window_end := (v_day + v_bh.end_time) at time zone v_tz;
      v_overlap_start := greatest(v_window_start, p_start);
      v_overlap_end := least(v_window_end, p_end);
      if v_overlap_end > v_overlap_start then
        v_total := v_total + (v_overlap_end - v_overlap_start);
      end if;
    end loop;
  end loop;

  return v_total;
end;
$$;

alter function public.business_hours_elapsed(uuid, timestamptz, timestamptz) owner to postgres;
grant execute on function public.business_hours_elapsed(uuid, timestamptz, timestamptz) to authenticated, service_role;
