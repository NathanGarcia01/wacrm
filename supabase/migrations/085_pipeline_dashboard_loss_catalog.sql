-- ============================================================
-- 085_pipeline_dashboard_loss_catalog.sql
--
-- Fase 4, Etapa 2 (continuação) — get_pipeline_dashboard()'s
-- "Perdidos por motivo" (migration 083) agora prefere o catálogo
-- (deals.lost_reason_id → deal_loss_reasons.label, migration 084)
-- quando presente, e só cai no agrupamento por texto livre
-- (lower(trim(lost_reason))) pra quem não tem — dado antigo (antes
-- da 084) ou escolha "Outro" no diálogo.
--
-- As duas partes são somadas por label ANTES de montar o jsonb final
-- (`loss_merged`) — sem isso, um negócio ligado ao catálogo "Sem
-- margem" e outro com texto livre "Sem margem" (digitado via "Outro"
-- em vez de escolhido no chip) apareceriam como duas barras
-- idênticas no gráfico em vez de uma só.
--
-- Mesma assinatura da migration 083 (nenhum parâmetro novo) — CREATE
-- OR REPLACE substitui a função existente sem precisar de DROP.
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
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

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
  -- Catalog-linked part (migration 084) — exact, no text normalization.
  loss_catalog_part as (
    select r.label as label, count(*) as cnt, sum(d.value) as total_value
    from lost_period_deals d
    join public.deal_loss_reasons r on r.id = d.lost_reason_id
    group by r.label
  ),
  -- Free-text fallback — same lower(trim()) grouping as 083, scoped to
  -- whatever ISN'T catalog-linked (pre-084 deals, or "Outro" picks).
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
  -- Re-merged by label: a catalog pick and a same-text "Outro" pick
  -- must render as one bar, not two.
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
  -- Último toque, atribuição única — ver comentário da migration 083.
  -- Só avalia deals relevantes pro período (criados OU ganhos dentro
  -- de [p_start,p_end)) — não é todo deal da conta, pra manter a
  -- subquery correlacionada barata.
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
      'attribution_window_days', v_attribution_window_days
    ),
    'cards', (select row_to_json(cards)::jsonb from cards),
    'avg_time_to_win_days', (select avg_days from avg_time_to_win),
    'funnel', (select data from funnel),
    'deals_per_day', (select data from deals_per_day),
    'commission_by_agent', (select data from commission_by_agent),
    'loss_by_reason', (select data from loss_by_reason),
    'conversion_by_source', (select data from conversion_by_source),
    'conversion_by_campaign', (select data from conversion_by_campaign)
  )
  into v_result;

  return v_result;
end;
$$;

alter function public.get_pipeline_dashboard(uuid, timestamptz, timestamptz) owner to postgres;
grant execute on function public.get_pipeline_dashboard(uuid, timestamptz, timestamptz) to authenticated, service_role;
