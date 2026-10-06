-- ============================================================
-- 082_get_user_summary_dashboard.sql
--
-- Fase 3 (dashboards) — Resumo por usuário: uma linha por atendente
-- (+ "Sem atendente"), mesma arquitetura de get_ticket_dashboard
-- (077-079) e get_sla_dashboard (080-081) — RPC única, SECURITY
-- DEFINER + is_account_member manual, search_path fixo, fuso da
-- conta, sem filtro de usuário (o ponto da aba é comparar todo
-- mundo de uma vez).
--
-- Reaproveita get_sla_dashboard() por CHAMADA DIRETA (não duplica a
-- regra de violação "julgada mesmo sem fechar" da migration 081) —
-- extrai `agent_ranking` do jsonb que ela já devolve, passando
-- p_user_id=null pra pegar todos os atendentes de uma vez.
--
-- TMA e 1ª resposta usam a mesma fórmula de get_ticket_dashboard
-- (078/079: case when p_business_hours then business_hours_elapsed
-- else wall-clock), só que agrupada por assigned_agent_id em vez de
-- agregada pra conta toda — média (avg) E mediana
-- (percentile_cont(0.5) within group), ambas sobre o `elapsed`
-- (interval) direto, convertidas pra segundos só no resultado final
-- (extract(epoch) nas DUAS agregações, não linha a linha).
--
-- "Mensagens enviadas": messages não guarda quem enviou (sender_id
-- nunca é populado de forma confiável — ver comentário em
-- src/lib/reports/queries.ts). Atribuição via o ticket vigente no
-- instante do envio (join por intervalo opened_at/closed_at) — mais
-- preciso que usar o responsável ATUAL da conversa, mas mensagens de
-- antes do rollout de tickets (Fase 1) ou num gap sem ticket aberto
-- ficam de fora da contagem (não atribuídas a ninguém).
--
-- "Transferências feitas" conta por actor_id (quem executou a
-- transferência) — "recebidas" conta por to_agent_id. Dois conceitos
-- diferentes de propósito (ver migration 070's ticket_events).
--
-- deals.assigned_to aponta pra profiles.id (FK real,
-- deals_assigned_to_fkey — migration 002); todo o resto
-- (tickets.assigned_agent_id, ticket_events.*, nps_surveys.
-- assigned_agent_id) é bare uuid pra profiles.user_id. A função usa
-- user_id como chave canônica — deals_by_agent resolve via join em
-- profiles antes de agrupar.
--
-- Deals/NPS não aplicam os filtros de departamento/canal (mesma
-- excepção já usada em new_contacts no get_ticket_dashboard — nem
-- deals nem nps_surveys têm department_id/channel_id próprio).
-- ============================================================

create index if not exists idx_ticket_events_account_actor_created
  on public.ticket_events(account_id, actor_id, created_at);

create index if not exists idx_ticket_events_account_to_agent_created
  on public.ticket_events(account_id, to_agent_id, created_at);

create or replace function public.get_user_summary_dashboard(
  p_account_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_department_id uuid default null,
  p_channel_id uuid default null,
  p_business_hours boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_sla jsonb;
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  v_sla := public.get_sla_dashboard(p_account_id, p_start, p_end, null, p_department_id, p_channel_id);

  with period_tickets as (
    select t.*
    from public.tickets t
    where t.account_id = p_account_id
      and t.opened_at >= p_start and t.opened_at < p_end
      and (p_department_id is null or t.department_id = p_department_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
  ),
  closed_period_tickets as (
    select t.*
    from public.tickets t
    where t.account_id = p_account_id
      and t.status = 'closed'
      and t.closed_at >= p_start and t.closed_at < p_end
      and (p_department_id is null or t.department_id = p_department_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
  ),
  current_status_tickets as (
    select t.*
    from public.tickets t
    where t.account_id = p_account_id
      and t.status = 'in_progress'
      and (p_department_id is null or t.department_id = p_department_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
  ),
  received_by_agent as (
    select assigned_agent_id as agent_id, count(*) as cnt
    from period_tickets
    group by assigned_agent_id
  ),
  closed_by_agent as (
    select assigned_agent_id as agent_id, count(*) as cnt
    from closed_period_tickets
    group by assigned_agent_id
  ),
  in_progress_by_agent as (
    select assigned_agent_id as agent_id, count(*) as cnt
    from current_status_tickets
    group by assigned_agent_id
  ),
  tma_raw as (
    select
      assigned_agent_id as agent_id,
      case when p_business_hours then public.business_hours_elapsed(p_account_id, opened_at, closed_at)
           else closed_at - opened_at end as elapsed
    from closed_period_tickets
    where closed_by = 'agent' and not is_backfill
  ),
  tma_by_agent as (
    select agent_id,
      extract(epoch from avg(elapsed)) as mean_seconds,
      extract(epoch from percentile_cont(0.5) within group (order by elapsed)) as median_seconds
    from tma_raw
    group by agent_id
  ),
  fr_raw as (
    select
      assigned_agent_id as agent_id,
      case when p_business_hours then public.business_hours_elapsed(p_account_id, opened_at, first_response_at)
           else first_response_at - opened_at end as elapsed
    from period_tickets
    where initiated_by = 'customer' and first_response_at is not null and not is_backfill
  ),
  fr_by_agent as (
    select agent_id,
      extract(epoch from avg(elapsed)) as mean_seconds,
      extract(epoch from percentile_cont(0.5) within group (order by elapsed)) as median_seconds
    from fr_raw
    group by agent_id
  ),
  messages_by_agent as (
    select t.assigned_agent_id as agent_id, count(*) as cnt
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.tickets t
      on t.conversation_id = c.id
      and m.created_at >= t.opened_at
      and m.created_at < coalesce(t.closed_at, 'infinity'::timestamptz)
    where t.account_id = p_account_id
      and m.sender_type = 'agent'
      and m.created_at >= p_start and m.created_at < p_end
      and (p_department_id is null or t.department_id = p_department_id)
      and (p_channel_id is null or c.channel_id = p_channel_id)
    group by t.assigned_agent_id
  ),
  transfers_made_by_agent as (
    select e.actor_id as agent_id, count(*) as cnt
    from public.ticket_events e
    join public.tickets t on t.id = e.ticket_id
    where e.account_id = p_account_id
      and e.type = 'transferred'
      and e.created_at >= p_start and e.created_at < p_end
      and (p_department_id is null or t.department_id = p_department_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
    group by e.actor_id
  ),
  transfers_received_by_agent as (
    select e.to_agent_id as agent_id, count(*) as cnt
    from public.ticket_events e
    join public.tickets t on t.id = e.ticket_id
    where e.account_id = p_account_id
      and e.type = 'transferred'
      and e.created_at >= p_start and e.created_at < p_end
      and (p_department_id is null or t.department_id = p_department_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
    group by e.to_agent_id
  ),
  deals_by_agent as (
    select p.user_id as agent_id, count(*) as cnt, sum(d.value) as total_value
    from public.deals d
    join public.profiles p on p.id = d.assigned_to
    where d.account_id = p_account_id
      and d.status = 'won'
      and d.won_at >= p_start and d.won_at < p_end
    group by p.user_id
  ),
  nps_by_agent as (
    select assigned_agent_id as agent_id, avg(rating) as avg_rating
    from public.nps_surveys
    where account_id = p_account_id
      and rating is not null
      and sent_at >= p_start and sent_at < p_end
    group by assigned_agent_id
  ),
  sla_by_agent as (
    select
      (elem ->> 'agent_id')::uuid as agent_id,
      (elem ->> 'fr_total')::int as fr_total,
      (elem ->> 'fr_within')::int as fr_within,
      (elem ->> 'res_total')::int as res_total,
      (elem ->> 'res_within')::int as res_within
    from jsonb_array_elements(v_sla -> 'agent_ranking') elem
  ),
  all_agents as (
    select agent_id from received_by_agent
    union select agent_id from closed_by_agent
    union select agent_id from in_progress_by_agent
    union select agent_id from tma_by_agent
    union select agent_id from fr_by_agent
    union select agent_id from messages_by_agent
    union select agent_id from transfers_made_by_agent
    union select agent_id from transfers_received_by_agent
    union select agent_id from deals_by_agent
    union select agent_id from nps_by_agent
    union select agent_id from sla_by_agent
  ),
  rows_cte as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', a.agent_id,
      'received', coalesce(r.cnt, 0),
      'closed', coalesce(cl.cnt, 0),
      'in_progress', coalesce(ip.cnt, 0),
      'tma_mean_seconds', tma.mean_seconds,
      'tma_median_seconds', tma.median_seconds,
      'first_response_mean_seconds', fr.mean_seconds,
      'first_response_median_seconds', fr.median_seconds,
      'sla_fr_total', coalesce(sla.fr_total, 0),
      'sla_fr_within', coalesce(sla.fr_within, 0),
      'sla_res_total', coalesce(sla.res_total, 0),
      'sla_res_within', coalesce(sla.res_within, 0),
      'messages_sent', coalesce(msg.cnt, 0),
      'transfers_made', coalesce(tm.cnt, 0),
      'transfers_received', coalesce(tr.cnt, 0),
      'nps_avg_rating', nps.avg_rating,
      'deals_won', coalesce(dl.cnt, 0),
      'deals_won_value', coalesce(dl.total_value, 0)
    )), '[]'::jsonb) as data
    from all_agents a
    left join received_by_agent r on r.agent_id is not distinct from a.agent_id
    left join closed_by_agent cl on cl.agent_id is not distinct from a.agent_id
    left join in_progress_by_agent ip on ip.agent_id is not distinct from a.agent_id
    left join tma_by_agent tma on tma.agent_id is not distinct from a.agent_id
    left join fr_by_agent fr on fr.agent_id is not distinct from a.agent_id
    left join messages_by_agent msg on msg.agent_id is not distinct from a.agent_id
    left join transfers_made_by_agent tm on tm.agent_id is not distinct from a.agent_id
    left join transfers_received_by_agent tr on tr.agent_id is not distinct from a.agent_id
    left join deals_by_agent dl on dl.agent_id is not distinct from a.agent_id
    left join nps_by_agent nps on nps.agent_id is not distinct from a.agent_id
    left join sla_by_agent sla on sla.agent_id is not distinct from a.agent_id
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'department_id', p_department_id,
      'channel_id', p_channel_id,
      'timezone', v_tz,
      'business_hours', p_business_hours,
      'first_response_goal_minutes', (v_sla -> 'filters' ->> 'first_response_goal_minutes')::int,
      'resolution_goal_minutes', (v_sla -> 'filters' ->> 'resolution_goal_minutes')::int
    ),
    'rows', (select data from rows_cte)
  )
  into v_result;

  return v_result;
end;
$$;

alter function public.get_user_summary_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, boolean) owner to postgres;
grant execute on function public.get_user_summary_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, boolean) to authenticated, service_role;
