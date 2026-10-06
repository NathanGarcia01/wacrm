-- ============================================================
-- 083_get_pipeline_dashboard.sql
--
-- Fase 3 (dashboards) — completa a aba "Pipeline & Vendas" (não é
-- aba nova). Move os 5 fetches client-side de
-- src/lib/reports/pipeline-queries.ts (hoje SEM nenhuma RPC, 100%
-- fetch de linhas cruas + agregação em JS) pra uma função única,
-- mesmo esqueleto das três rodadas anteriores (SECURITY DEFINER +
-- is_account_member manual, search_path fixo).
--
-- Bug de corretude que esta migration resolve: duas das queries
-- atuais (`openStagesRes`/`openCommissionRes`) buscam TODO o pipeline
-- aberto sem filtro de período e sem paginação — o limite implícito
-- de 1000 linhas do PostgREST pode truncar o funil/comissão prevista
-- silenciosamente numa conta com pipeline grande. Agregado aqui no
-- banco, sem esse limite.
--
-- Sem filtro de departamento/canal/usuário — a aba hoje só tem
-- filtro de período, não estou adicionando o que não existia.
--
-- ------------------------------------------------------------
-- Atribuição ticket → negócio (3 métricas novas: conversão por
-- origem, por campanha, tempo até ganhar) — REGRA DIFERENTE da do
-- ROI de Transmissões (src/lib/reports/broadcast-roi-queries.ts), e
-- de propósito:
--
-- O ROI de Transmissões conta por aproximação SEM se importar com
-- duplicidade — um mesmo deal pode contar pra vários broadcasts
-- diferentes, porque lá a pergunta é "esse disparo teve alguma
-- participação no resultado?" (over-counting aceito e documentado:
-- "there's no single source of truth for which touch actually did
-- it").
--
-- Aqui a pergunta é outra: "esse negócio pertence a QUAL origem,
-- pra eu comparar origens entre si sem inflar nenhuma". Contagem
-- duplicada quebraria a comparação (a soma das origens não bateria
-- com o total de negócios). Por isso a regra muda pra ÚLTIMO TOQUE,
-- ÚNICA ATRIBUIÇÃO: cada negócio (com contact_id preenchido) é
-- ligado a NO MÁXIMO UM ticket — o mais recente do mesmo contato com
-- opened_at <= deals.created_at e dentro de
-- v_attribution_window_days dias antes (constante nomeada, 30 —
-- uma janela maior que isso vira palpite, não atribuição). Fora
-- dessa janela, ou sem ticket nenhum, ou sem contact_id: o negócio
-- entra no balde "Sem atendimento" (`source` null no jsonb) em vez
-- de ficar de fora silenciosamente — continua contável no total,
-- só não tem origem conhecida.
--
-- "Gerou negócio" e "Ganhos" usam essa MESMA atribuição (a mesma
-- subquery, dois filtros de data diferentes sobre o resultado) —
-- nenhum negócio conta pra mais de uma origem/campanha/ticket.
-- "Tempo até ganhar" usa o `opened_at` do ticket ATRIBUÍDO (não o
-- primeiro ticket da vida do contato, que seria a origem errada se
-- o contato voltou meses depois por um motivo não relacionado).
-- ------------------------------------------------------------
--
-- Dia de "deals por dia" passa a ser bucketado no FUSO DA CONTA
-- (mesma convenção das outras 3 rodadas da Fase 3) em vez do fuso do
-- navegador de quem está vendo — mudança pequena e deliberada: um
-- relatório compartilhado não deveria mudar de corte de dia conforme
-- o fuso de quem abre a tela.
--
-- "Perdidos por motivo": `deals.lost_reason` é texto livre, SEM FK
-- pra `deal_loss_reasons` (confirmado, migration 027) — agrupa por
-- `lower(trim(lost_reason))` (join por grafia, maiúscula/minúscula e
-- espaço não contam como motivos diferentes) e exibe a grafia mais
-- frequente dentro de cada grupo como label (`display_label` via
-- `distinct on` ordenado por contagem desc).
-- ============================================================

create index if not exists idx_deals_account_contact
  on public.deals(account_id, contact_id);

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
  loss_raw as (
    select lower(trim(coalesce(lost_reason, ''))) as norm, coalesce(lost_reason, '') as raw, value
    from lost_period_deals
  ),
  loss_label_counts as (
    select norm, raw, count(*) as cnt
    from loss_raw
    group by norm, raw
  ),
  loss_best_label as (
    select distinct on (norm) norm, raw as display_label
    from loss_label_counts
    order by norm, cnt desc, raw
  ),
  loss_totals as (
    select norm, count(*) as total_cnt, sum(value) as total_value
    from loss_raw
    group by norm
  ),
  loss_by_reason as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'label', bl.display_label, 'count', lt.total_cnt, 'value', lt.total_value
    ) order by lt.total_cnt desc), '[]'::jsonb) as data
    from loss_totals lt
    join loss_best_label bl on bl.norm = lt.norm
  ),
  -- Último toque, atribuição única — ver comentário da migration no
  -- topo do arquivo. Só avalia deals relevantes pro período (criados
  -- OU ganhos dentro de [p_start,p_end)) — não é todo deal da conta,
  -- pra manter a subquery correlacionada barata.
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
