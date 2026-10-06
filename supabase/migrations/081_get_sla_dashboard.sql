-- ============================================================
-- 081_get_sla_dashboard.sql
--
-- Fase 3 (dashboards) — Dash de SLA, Etapa 2: get_sla_dashboard(),
-- a função principal. Mesmo esqueleto de get_ticket_dashboard()
-- (migrations 077-079): SECURITY DEFINER + is_account_member manual,
-- search_path fixo, filtros de usuário/departamento/canal, fuso da
-- conta, is_backfill fora de tudo.
--
-- Regra central (correção de escopo pedida antes de implementar —
-- violação não pode esperar o ticket fechar pra contar):
--   - Um ticket só entra no cálculo quando já dá pra JULGAR se
--     cumpriu a meta ou não. Pra 1ª resposta: julgado quando já
--     respondeu (dentro ou fora da meta) OU quando ainda não
--     respondeu mas o tempo decorrido (corrido ou em horas úteis,
--     conforme a meta) já passou da meta — nesse caso é violação na
--     hora, mesmo sem resposta. Sem resposta e ainda dentro da meta
--     fica de fora (ainda não se decidiu).
--   - Pra resolução: julgado quando já fechou (dentro ou fora da
--     meta) OU quando ainda está aberto mas o tempo decorrido desde
--     a abertura já passou da meta — violação na hora. Aberto e
--     ainda dentro da meta fica de fora.
--   - Em ambos os casos o "tempo decorrido" pra um ticket ainda em
--     aberto usa now() como referência — é uma leitura viva: um
--     ticket parado na mesma consulta pode virar violação minutos
--     depois, sem nenhuma mudança nele mesmo.
--   - "dentro da meta" = julgado E NÃO acima da meta. Dá pra
--     simplificar pra `not over_goal` porque todo ticket julgado com
--     resposta/fechamento tardio já cai em over_goal=true, e todo
--     ticket julgado sem resposta/fechamento SÓ está no conjunto
--     julgado por já estar over_goal=true — não existe "julgado,
--     sem resposta, dentro da meta".
--
-- Fechamento por sistema (closed_by='system', ex.: timeout de
-- inatividade) fica fora do lado "resolução" assim que fechado —
-- mesma exclusão já aplicada ao TMA em get_ticket_dashboard. Um
-- ticket ainda aberto não tem closed_by ainda, então essa exclusão
-- só se aplica ao ramo "já fechou".
--
-- Meta não configurada (coluna NULL em accounts) = lado inteiro fica
-- de fora (cards zerados, mas o front sabe por `filters.*_goal_minutes
-- is null` que é "meta não configurada", não "0% de conformidade").
--
-- "Em risco agora" (at_risk) é live, igual current_status_tickets em
-- get_ticket_dashboard — ignora p_start/p_end de propósito: é a fila
-- viva de tickets abertos sem 1ª resposta, >=80% do tempo da meta já
-- consumido, limitado a 20, ordenado por mais urgente primeiro.
-- ============================================================

create or replace function public.get_sla_dashboard(
  p_account_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_user_id uuid default null,
  p_department_id uuid default null,
  p_channel_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_fr_minutes integer;
  v_fr_bh boolean;
  v_res_minutes integer;
  v_res_bh boolean;
  v_hourly boolean;
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone, sla_first_response_minutes, sla_first_response_business_hours,
         sla_resolution_minutes, sla_resolution_business_hours
    into v_tz, v_fr_minutes, v_fr_bh, v_res_minutes, v_res_bh
  from public.accounts where id = p_account_id;

  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  v_hourly := (p_end - p_start) <= interval '1 day';

  with period_tickets as (
    select t.*
    from public.tickets t
    where t.account_id = p_account_id
      and t.opened_at >= p_start and t.opened_at < p_end
      and not t.is_backfill
      and (p_department_id is null or t.department_id = p_department_id)
      and (p_user_id is null or t.assigned_agent_id = p_user_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
  ),
  fr_scored as (
    select
      t.id,
      t.assigned_agent_id,
      t.opened_at,
      (t.first_response_at is not null) as has_response,
      (
        case when v_fr_bh then public.business_hours_elapsed(
          p_account_id, t.opened_at,
          coalesce(t.first_response_at, case when t.status = 'closed' then t.closed_at else now() end)
        ) else
          coalesce(t.first_response_at, case when t.status = 'closed' then t.closed_at else now() end) - t.opened_at
        end
      ) > (v_fr_minutes * interval '1 minute') as over_goal
    from period_tickets t
    where v_fr_minutes is not null
      and t.initiated_by = 'customer'
  ),
  fr_final as (
    select * from fr_scored where has_response or over_goal
  ),
  res_scored as (
    select
      t.id,
      t.assigned_agent_id,
      t.opened_at,
      (t.status = 'closed') as is_closed,
      (
        case when v_res_bh then public.business_hours_elapsed(
          p_account_id, t.opened_at,
          case when t.status = 'closed' then t.closed_at else now() end
        ) else
          (case when t.status = 'closed' then t.closed_at else now() end) - t.opened_at
        end
      ) > (v_res_minutes * interval '1 minute') as over_goal
    from period_tickets t
    where v_res_minutes is not null
      and (t.status <> 'closed' or t.closed_by = 'agent')
  ),
  res_final as (
    select * from res_scored where is_closed or over_goal
  ),
  cards as (
    select
      (select count(*) from fr_final) as fr_total,
      (select count(*) from fr_final where not over_goal) as fr_within,
      (select count(*) from res_final) as res_total,
      (select count(*) from res_final where not over_goal) as res_within
  ),
  fr_by_bucket as (
    select
      case when v_hourly
        then to_char(date_trunc('hour', opened_at at time zone v_tz), 'YYYY-MM-DD"T"HH24:00:00')
        else to_char((opened_at at time zone v_tz)::date, 'YYYY-MM-DD')
      end as bucket,
      count(*) as total,
      count(*) filter (where not over_goal) as within
    from fr_final
    group by 1
  ),
  res_by_bucket as (
    select
      case when v_hourly
        then to_char(date_trunc('hour', opened_at at time zone v_tz), 'YYYY-MM-DD"T"HH24:00:00')
        else to_char((opened_at at time zone v_tz)::date, 'YYYY-MM-DD')
      end as bucket,
      count(*) as total,
      count(*) filter (where not over_goal) as within
    from res_final
    group by 1
  ),
  by_day as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', bucket,
      'fr_total', fr_total, 'fr_within', fr_within,
      'res_total', res_total, 'res_within', res_within
    ) order by bucket), '[]'::jsonb) as data
    from (
      select
        coalesce(f.bucket, r.bucket) as bucket,
        coalesce(f.total, 0) as fr_total, coalesce(f.within, 0) as fr_within,
        coalesce(r.total, 0) as res_total, coalesce(r.within, 0) as res_within
      from fr_by_bucket f
      full outer join res_by_bucket r on r.bucket = f.bucket
    ) x
  ),
  fr_by_agent as (
    select assigned_agent_id as agent_id, count(*) as total, count(*) filter (where not over_goal) as within
    from fr_final group by assigned_agent_id
  ),
  res_by_agent as (
    select assigned_agent_id as agent_id, count(*) as total, count(*) filter (where not over_goal) as within
    from res_final group by assigned_agent_id
  ),
  -- `FULL JOIN ... IS NOT DISTINCT FROM` isn't merge/hash-joinable in
  -- Postgres (needed because assigned_agent_id can be null, "Sem
  -- atendente") — union the agent ids from both sides first, then
  -- LEFT JOIN each in (nested-loop-safe with a null-aware condition).
  all_agents as (
    select agent_id from fr_by_agent
    union
    select agent_id from res_by_agent
  ),
  by_agent as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', a.agent_id,
      'fr_total', coalesce(f.total, 0), 'fr_within', coalesce(f.within, 0),
      'res_total', coalesce(r.total, 0), 'res_within', coalesce(r.within, 0)
    )), '[]'::jsonb) as data
    from all_agents a
    left join fr_by_agent f on f.agent_id is not distinct from a.agent_id
    left join res_by_agent r on r.agent_id is not distinct from a.agent_id
  ),
  at_risk_candidates as (
    select
      t.id as rid, t.conversation_id as conv_id, t.protocol_number as proto,
      coalesce(ct.name, ct.phone) as cname, d.name as dname, t.assigned_agent_id as aid,
      t.opened_at as oat,
      (
        extract(epoch from
          case when v_fr_bh then public.business_hours_elapsed(p_account_id, t.opened_at, now())
               else now() - t.opened_at end
        ) / (v_fr_minutes * 60.0)
      ) * 100 as pct
    from public.tickets t
    join public.conversations c on c.id = t.conversation_id
    left join public.contacts ct on ct.id = c.contact_id
    left join public.departments d on d.id = t.department_id
    where t.account_id = p_account_id
      and v_fr_minutes is not null
      and t.status in ('pending', 'in_progress')
      and t.initiated_by = 'customer'
      and t.first_response_at is null
      and not t.is_backfill
      and (p_department_id is null or t.department_id = p_department_id)
      and (p_user_id is null or t.assigned_agent_id = p_user_id)
      and (p_channel_id is null or c.channel_id = p_channel_id)
  ),
  at_risk_top as (
    select * from at_risk_candidates
    -- 80% consumido da meta = "em risco" — dá folga pro atendente
    -- agir antes de estourar de verdade (pct pode passar de 100,
    -- isso é esperado: já estourou e continua sem resposta).
    where pct >= 80
    order by pct desc
    limit 20
  ),
  at_risk as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ticket_id', rid, 'conversation_id', conv_id, 'protocol_number', proto,
      'contact_name', cname, 'department_name', dname, 'agent_id', aid,
      'opened_at', oat, 'pct_elapsed', pct
    ) order by pct desc), '[]'::jsonb) as data
    from at_risk_top
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'user_id', p_user_id,
      'department_id', p_department_id,
      'channel_id', p_channel_id,
      'timezone', v_tz,
      'granularity', case when v_hourly then 'hour' else 'day' end,
      'first_response_goal_minutes', v_fr_minutes,
      'first_response_business_hours', v_fr_bh,
      'resolution_goal_minutes', v_res_minutes,
      'resolution_business_hours', v_res_bh
    ),
    'cards', (select row_to_json(cards)::jsonb from cards),
    'charts', jsonb_build_object('daily', (select data from by_day)),
    'agent_ranking', (select data from by_agent),
    'at_risk', (select data from at_risk)
  )
  into v_result;

  return v_result;
end;
$$;

alter function public.get_sla_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid) owner to postgres;
grant execute on function public.get_sla_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid) to authenticated, service_role;
