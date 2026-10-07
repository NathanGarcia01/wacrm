-- ============================================================
-- 087_sales_goals.sql
--
-- Fase 4, Etapa 4 — Meta de vendas: meta mensal por conta (valor e/ou
-- quantidade) e meta mensal por usuário, com progresso mostrado em
-- get_pipeline_dashboard() (migration 085) e get_user_summary_dashboard()
-- (migration 082).
--
-- Meta por conta: colunas simples em `accounts`, mesmo padrão exato
-- de `080_sla_goals.sql` — NULL = meta desativada, nunca 0, CHECK de
-- positividade.
--
-- Meta por usuário: tabela nova `account_user_sales_goals`, chave
-- (account_id, month, user_id) NESSA ORDEM — `month` antes de
-- `user_id` de propósito, porque toda consulta real é "metas da
-- conta NESTE mês" (todas as pessoas), nunca "este usuário em todos
-- os meses" — com `user_id` como última coluna da PK, o lookup por
-- (account_id, month) é um range scan direto no índice da própria
-- PK, sem precisar de índice extra. `user_id` é uuid solto, sem FK,
-- mesmo padrão já usado em toda a Fase 3
-- (tickets.assigned_agent_id, ticket_events.actor_id/to_agent_id —
-- aponta pra profiles.user_id por convenção, não por constraint).
--
-- Progresso sempre contra o MÊS CALENDÁRIO ATUAL no fuso da conta —
-- independente do período escolhido no filtro da aba (decisão já
-- registrada no plano: comparar uma meta mensal com uma janela
-- arbitrária de dias não faz sentido). Front usa `filters.sales_goal_month`
-- (YYYY-MM-01) devolvido pela própria função pra nomear o card ("Meta
-- de outubro") sem precisar calcular "que mês é agora" duas vezes.
-- ============================================================

alter table public.accounts
  add column if not exists sales_goal_value numeric,
  add column if not exists sales_goal_count integer;

alter table public.accounts
  drop constraint if exists accounts_sales_goal_value_positive;
alter table public.accounts
  add constraint accounts_sales_goal_value_positive
    check (sales_goal_value is null or sales_goal_value > 0);

alter table public.accounts
  drop constraint if exists accounts_sales_goal_count_positive;
alter table public.accounts
  add constraint accounts_sales_goal_count_positive
    check (sales_goal_count is null or sales_goal_count > 0);

create table if not exists public.account_user_sales_goals (
  account_id uuid not null references public.accounts(id) on delete cascade,
  month date not null,
  user_id uuid not null,
  value_goal numeric,
  count_goal integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, month, user_id),
  check (value_goal is null or value_goal > 0),
  check (count_goal is null or count_goal > 0)
);

alter table public.account_user_sales_goals enable row level security;

drop policy if exists account_user_sales_goals_select on public.account_user_sales_goals;
create policy account_user_sales_goals_select on public.account_user_sales_goals
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists account_user_sales_goals_insert on public.account_user_sales_goals;
create policy account_user_sales_goals_insert on public.account_user_sales_goals
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists account_user_sales_goals_update on public.account_user_sales_goals;
create policy account_user_sales_goals_update on public.account_user_sales_goals
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists account_user_sales_goals_delete on public.account_user_sales_goals;
create policy account_user_sales_goals_delete on public.account_user_sales_goals
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- get_pipeline_dashboard() — adiciona `sales_goal` (meta + real do
-- mês corrente), sem tocar em nenhuma outra parte da função
-- (migration 085).
-- ------------------------------------------------------------
create or replace function public.get_pipeline_dashboard(
  p_account_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_attribution_window_days constant int := 30;
  v_month_start_local timestamp;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_month_key date;
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  v_month_start_local := date_trunc('month', now() at time zone v_tz);
  v_month_start := v_month_start_local at time zone v_tz;
  v_month_end := (v_month_start_local + interval '1 month') at time zone v_tz;
  v_month_key := v_month_start_local::date;

  with created_period_deals as (
    select d.* from public.deals d
    where d.account_id = p_account_id
      and d.created_at >= p_start and d.created_at < p_end
  ),
  won_period_deals as (
    select d.* from public.deals d
    where d.account_id = p_account_id
      and d.status = 'won'
      and d.won_at >= p_start and d.won_at < p_end
  ),
  lost_period_deals as (
    select d.* from public.deals d
    where d.account_id = p_account_id
      and d.status = 'lost'
      and d.lost_at >= p_start and d.lost_at < p_end
  ),
  open_deals as (
    select d.* from public.deals d
    where d.account_id = p_account_id and d.status = 'open'
  ),
  -- Independente de p_start/p_end — sempre o mês calendário atual da
  -- conta, ver comentário da migration no topo do arquivo.
  current_month_won_deals as (
    select d.* from public.deals d
    where d.account_id = p_account_id
      and d.status = 'won'
      and d.won_at >= v_month_start and d.won_at < v_month_end
  ),
  sales_goal as (
    select
      v_month_key as month,
      a.sales_goal_value as value_goal,
      a.sales_goal_count as count_goal,
      coalesce((select sum(value) from current_month_won_deals), 0) as value_actual,
      coalesce((select count(*) from current_month_won_deals), 0) as count_actual
    from public.accounts a
    where a.id = p_account_id
  ),
  cards as (
    select
      (select count(*) from created_period_deals) as deals_created,
      (select count(*) from won_period_deals) as deals_won,
      (select count(*) from lost_period_deals) as deals_lost,
      (select sum(value) from won_period_deals) as value_won,
      (select avg(value) from won_period_deals) as avg_ticket,
      (select extract(epoch from avg(won_at - created_at)) / 86400.0 from won_period_deals) as avg_close_days,
      (
        select sum(dp.commission_value)
        from public.deal_products dp
        join won_period_deals w on w.id = dp.deal_id
      ) as commission_won,
      (
        select sum(dp.commission_value)
        from public.deal_products dp
        join open_deals o on o.id = dp.deal_id
      ) as commission_projected
  ),
  funnel as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'stage_id', ps.id, 'name', ps.name, 'color', ps.color, 'position', ps.position, 'count', x.cnt
    ) order by ps.position), '[]'::jsonb) as data
    from (
      select stage_id, count(*) as cnt
      from open_deals
      group by stage_id
    ) x
    join public.pipeline_stages ps on ps.id = x.stage_id
  ),
  deals_per_day as (
    select coalesce(jsonb_agg(jsonb_build_object('date', day, 'won', cnt) order by day), '[]'::jsonb) as data
    from (
      select (won_at at time zone v_tz)::date as day, count(*) as cnt
      from won_period_deals
      group by 1
    ) x
  ),
  commission_by_agent as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id', pid, 'name', pname, 'commission_won', ccommission, 'deals_won', cnt
    ) order by ccommission desc), '[]'::jsonb) as data
    from (
      select p.id as pid, coalesce(p.full_name, p.email) as pname,
        sum(dp.commission_value) as ccommission, count(distinct w.id) as cnt
      from won_period_deals w
      join public.profiles p on p.id = w.assigned_to
      join public.deal_products dp on dp.deal_id = w.id
      group by p.id, p.full_name, p.email
      having sum(dp.commission_value) > 0
    ) x
  ),
  loss_catalog_part as (
    select r.label as label, count(*) as cnt, sum(d.value) as total_value
    from lost_period_deals d
    join public.deal_loss_reasons r on r.id = d.lost_reason_id
    group by r.label
  ),
  loss_freetext_raw as (
    select lower(trim(coalesce(lost_reason, ''))) as norm, coalesce(lost_reason, '') as raw, value
    from lost_period_deals
    where lost_reason_id is null
  ),
  loss_freetext_label_counts as (
    select norm, raw, count(*) as cnt
    from loss_freetext_raw
    group by norm, raw
  ),
  loss_freetext_best_label as (
    select distinct on (norm) norm, raw as display_label
    from loss_freetext_label_counts
    order by norm, cnt desc, raw
  ),
  loss_freetext_totals as (
    select norm, count(*) as total_cnt, sum(value) as total_value
    from loss_freetext_raw
    group by norm
  ),
  loss_freetext_part as (
    select bl.display_label as label, lt.total_cnt as cnt, lt.total_value as total_value
    from loss_freetext_totals lt
    join loss_freetext_best_label bl on bl.norm = lt.norm
  ),
  loss_merged as (
    select label, sum(cnt) as total_cnt, sum(total_value) as total_value
    from (
      select * from loss_catalog_part
      union all
      select * from loss_freetext_part
    ) combined
    group by label
  ),
  loss_by_reason as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'label', label, 'count', total_cnt, 'value', total_value
    ) order by total_cnt desc), '[]'::jsonb) as data
    from loss_merged
  ),
  deal_attribution as (
    select
      d.id as deal_id,
      d.status,
      d.created_at,
      d.won_at,
      (
        select t.id
        from public.tickets t
        join public.conversations c on c.id = t.conversation_id
        where c.contact_id = d.contact_id
          and t.account_id = p_account_id
          and t.opened_at <= d.created_at
          and t.opened_at >= d.created_at - (v_attribution_window_days * interval '1 day')
        order by t.opened_at desc
        limit 1
      ) as ticket_id
    from public.deals d
    where d.account_id = p_account_id
      and d.contact_id is not null
      and (
        (d.created_at >= p_start and d.created_at < p_end)
        or (d.status = 'won' and d.won_at >= p_start and d.won_at < p_end)
      )
  ),
  deal_attribution_src as (
    select da.*, t.source, t.campaign_id, t.opened_at as ticket_opened_at
    from deal_attribution da
    left join public.tickets t on t.id = da.ticket_id
  ),
  conversion_by_source as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', src, 'generated', generated_cnt, 'won', won_cnt
    )), '[]'::jsonb) as data
    from (
      select
        source as src,
        count(*) filter (where created_at >= p_start and created_at < p_end) as generated_cnt,
        count(*) filter (where status = 'won' and won_at >= p_start and won_at < p_end) as won_cnt
      from deal_attribution_src
      group by source
    ) x
  ),
  conversion_by_campaign as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', cid, 'campaign_name', cname, 'generated', generated_cnt, 'won', won_cnt
    )), '[]'::jsonb) as data
    from (
      select
        das.campaign_id as cid, b.name as cname,
        count(*) filter (where das.created_at >= p_start and das.created_at < p_end) as generated_cnt,
        count(*) filter (where das.status = 'won' and das.won_at >= p_start and das.won_at < p_end) as won_cnt
      from deal_attribution_src das
      join public.broadcasts b on b.id = das.campaign_id
      where das.source = 'campaign'
      group by das.campaign_id, b.name
    ) x
  ),
  avg_time_to_win as (
    select extract(epoch from avg(won_at - ticket_opened_at)) / 86400.0 as avg_days
    from deal_attribution_src
    where status = 'won' and won_at >= p_start and won_at < p_end and ticket_id is not null
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'timezone', v_tz,
      'attribution_window_days', v_attribution_window_days,
      'sales_goal_month', v_month_key
    ),
    'cards', (select row_to_json(cards)::jsonb from cards),
    'avg_time_to_win_days', (select avg_days from avg_time_to_win),
    'funnel', (select data from funnel),
    'deals_per_day', (select data from deals_per_day),
    'commission_by_agent', (select data from commission_by_agent),
    'loss_by_reason', (select data from loss_by_reason),
    'conversion_by_source', (select data from conversion_by_source),
    'conversion_by_campaign', (select data from conversion_by_campaign),
    'sales_goal', (select row_to_json(sales_goal)::jsonb from sales_goal)
  )
  into v_result;

  return v_result;
end;
$$;

alter function public.get_pipeline_dashboard(uuid, timestamptz, timestamptz) owner to postgres;
grant execute on function public.get_pipeline_dashboard(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------
-- get_user_summary_dashboard() — adiciona meta + real do mês
-- corrente POR AGENTE, sem tocar no resto (migration 082).
-- ------------------------------------------------------------
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
  v_month_start_local timestamp;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_month_key date;
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  v_month_start_local := date_trunc('month', now() at time zone v_tz);
  v_month_start := v_month_start_local at time zone v_tz;
  v_month_end := (v_month_start_local + interval '1 month') at time zone v_tz;
  v_month_key := v_month_start_local::date;

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
  -- Independente de p_start/p_end — sempre o mês calendário atual.
  current_month_won_by_agent as (
    select p.user_id as agent_id, count(*) as cnt, sum(d.value) as total_value
    from public.deals d
    join public.profiles p on p.id = d.assigned_to
    where d.account_id = p_account_id
      and d.status = 'won'
      and d.won_at >= v_month_start and d.won_at < v_month_end
    group by p.user_id
  ),
  user_goals as (
    select user_id as agent_id, value_goal, count_goal
    from public.account_user_sales_goals
    where account_id = p_account_id and month = v_month_key
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
    union select agent_id from current_month_won_by_agent
    union select agent_id from user_goals
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
      'deals_won_value', coalesce(dl.total_value, 0),
      'sales_goal_value', ug.value_goal,
      'sales_goal_count', ug.count_goal,
      'sales_actual_value_month', coalesce(cmw.total_value, 0),
      'sales_actual_count_month', coalesce(cmw.cnt, 0)
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
    left join current_month_won_by_agent cmw on cmw.agent_id is not distinct from a.agent_id
    left join user_goals ug on ug.agent_id is not distinct from a.agent_id
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
      'resolution_goal_minutes', (v_sla -> 'filters' ->> 'resolution_goal_minutes')::int,
      'sales_goal_month', v_month_key
    ),
    'rows', (select data from rows_cte)
  )
  into v_result;

  return v_result;
end;
$$;

alter function public.get_user_summary_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, boolean) owner to postgres;
grant execute on function public.get_user_summary_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, boolean) to authenticated, service_role;
