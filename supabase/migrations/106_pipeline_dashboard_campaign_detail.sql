-- ============================================================
-- 106_pipeline_dashboard_campaign_detail.sql
--
-- Fase 2 (visual) — aprovado um redesenho da aba Pipeline & Vendas
-- que precisa de 3 campos NOVOS por campanha (tabela "Campanhas
-- trouxeram X% dos negócios ganhos"), nenhum deles existente hoje em
-- get_pipeline_dashboard() (migration 087):
--
--   - tickets_total: quantos atendimentos aquela campanha gerou no
--     período (hoje só existe `generated`/`won`, contados sobre
--     negócios, não sobre atendimentos — uma campanha pode gerar
--     muito atendimento e pouco negócio, e isso não aparecia).
--   - won_value: soma do valor dos negócios GANHOS atribuídos à
--     campanha (hoje só existe a contagem `won`, não o valor).
--   - template_category: Marketing/Utility/Authentication do
--     template usado — mesmo dado já exposto no ROI de Transmissões
--     (broadcast-roi-queries.ts), nunca trazido pra cá.
--
-- TODO o resto da função (cards, funil, comissão, loss_by_reason,
-- conversion_by_source, avg_time_to_win, sales_goal) é copiado
-- BYTE A BYTE da 087 — nenhum cálculo já auditado muda aqui, só
-- aparecem 3 campos novos dentro de conversion_by_campaign.
-- ============================================================

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
      d.value,
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
  -- NEW — every ticket a campaign generated in the period, independent
  -- of whether it ever got deal-attributed (deal_attribution_src only
  -- has ONE ticket per deal, last-touch — a campaign's total reach is
  -- a different, bigger population). Opened_at-scoped, same convention
  -- as the Atendimento tab's own ticket counts.
  campaign_tickets as (
    select t.campaign_id as cid, count(*) as tickets_total
    from public.tickets t
    where t.account_id = p_account_id
      and t.source = 'campaign'
      and t.campaign_id is not null
      and t.opened_at >= p_start and t.opened_at < p_end
    group by t.campaign_id
  ),
  -- NEW — Marketing/Utility/Authentication, same lookup already used
  -- by the ROI de Transmissões tab (broadcast-roi-queries.ts), never
  -- surfaced here before. `distinct on` because a template name+
  -- language can now exist once per connected WABA (migration 47fdba3
  -- — sync used to only pull the default channel's WABA) — an
  -- unqualified join here would fan out and double-count the
  -- campaign's generated/won rows below. The category is the same
  -- across WABAs for a given template in practice, so picking
  -- whichever row sorts first is harmless.
  campaign_template_category as (
    select distinct on (b.id) b.id as cid, mt.category
    from public.broadcasts b
    left join public.message_templates mt
      on mt.name = b.template_name and mt.language = b.template_language and mt.account_id = p_account_id
    order by b.id, mt.category
  ),
  conversion_by_campaign as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', x.cid, 'campaign_name', x.cname, 'generated', x.generated_cnt, 'won', x.won_cnt,
      'tickets_total', coalesce(ct.tickets_total, 0),
      'won_value', coalesce(x.won_value_sum, 0),
      'template_category', tc.category
    )), '[]'::jsonb) as data
    from (
      select
        das.campaign_id as cid, b.name as cname,
        count(*) filter (where das.created_at >= p_start and das.created_at < p_end) as generated_cnt,
        count(*) filter (where das.status = 'won' and das.won_at >= p_start and das.won_at < p_end) as won_cnt,
        sum(das.value) filter (where das.status = 'won' and das.won_at >= p_start and das.won_at < p_end) as won_value_sum
      from deal_attribution_src das
      join public.broadcasts b on b.id = das.campaign_id
      where das.source = 'campaign'
      group by das.campaign_id, b.name
    ) x
    left join campaign_tickets ct on ct.cid = x.cid
    left join campaign_template_category tc on tc.cid = x.cid
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
