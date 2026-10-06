-- ============================================================
-- 078_ticket_dashboard_business_hours.sql
--
-- Fase 3 (dashboards) — Etapa 3: modo "horas úteis" do Dash de
-- Atendimento. Novo parâmetro p_business_hours (default false,
-- preserva o comportamento em tempo corrido da Etapa 2) troca TMA e
-- 1ª resposta de (closed_at - opened_at) / (first_response_at -
-- opened_at) em wall-clock para business_hours_elapsed() (migration
-- 076) — mesmas bases (closed_period_tickets / period_tickets),
-- mesmos filtros de is_backfill/closed_by/initiated_by da Etapa 2,
-- só a fórmula de duração muda.
--
-- 'business_hours_configured' entra em filters — true/false conforme
-- a conta tem alguma linha em business_hours. O front usa isso pra
-- mostrar "horário de atendimento não configurado" quando
-- p_business_hours=true e a conta não tem nada cadastrado (nesse
-- caso business_hours_elapsed() já cai pra tempo corrido por conta
-- própria — ver migration 076 — então os números continuam válidos,
-- só não são "horas úteis" de fato).
--
-- CASE WHEN p_business_hours em vez de duas queries sempre
-- calculadas: só o branch escolhido roda (subquery do outro lado do
-- CASE nunca é avaliada), então o modo tempo corrido (default) não
-- paga custo nenhum de business_hours_elapsed().
--
-- DROP antes do CREATE: Postgres identifica função pela lista de
-- tipos de parâmetro, não pelos defaults — um 7º parâmetro novo cria
-- uma OVERLOAD nova em vez de substituir a de 6 parâmetros da
-- migration 077 (e uma chamada com 6 args continuaria caindo na
-- versão antiga, sem horas úteis). Sem overload == sem essa
-- ambiguidade.
-- ============================================================

drop function if exists public.get_ticket_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid);

create or replace function public.get_ticket_dashboard(
  p_account_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_user_id uuid default null,
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
  v_bh_configured boolean;
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

  select exists(
    select 1 from public.business_hours where account_id = p_account_id
  ) into v_bh_configured;

  with period_tickets as (
    select t.*
    from public.tickets t
    where t.account_id = p_account_id
      and t.opened_at >= p_start and t.opened_at < p_end
      and (p_department_id is null or t.department_id = p_department_id)
      and (p_user_id is null or t.assigned_agent_id = p_user_id)
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
      and t.status in ('pending', 'in_progress')
      and (p_department_id is null or t.department_id = p_department_id)
      and (p_user_id is null or t.assigned_agent_id = p_user_id)
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
      and (p_user_id is null or t.assigned_agent_id = p_user_id)
      and (
        p_channel_id is null or exists (
          select 1 from public.conversations c
          where c.id = t.conversation_id and c.channel_id = p_channel_id
        )
      )
  ),
  cards as (
    select
      (select count(*) from period_tickets) as total_tickets,
      (select count(*) from period_tickets where initiated_by = 'customer') as initiated_by_customer,
      (select count(*) from period_tickets where initiated_by = 'company') as initiated_by_company,
      (select count(*) from current_status_tickets where status = 'pending') as pending,
      (select count(*) from current_status_tickets where status = 'in_progress') as in_progress,
      (select count(distinct assigned_agent_id) from period_tickets where assigned_agent_id is not null) as agents_count,
      (
        select count(distinct c.contact_id)
        from period_tickets pt
        join public.conversations c on c.id = pt.conversation_id
      ) as contacts_served,
      (
        select count(*) from public.contacts ct
        where ct.account_id = p_account_id
          and ct.created_at >= p_start and ct.created_at < p_end
      ) as new_contacts,
      (
        case when p_business_hours then (
          select extract(epoch from avg(public.business_hours_elapsed(p_account_id, opened_at, closed_at)))
          from closed_period_tickets
          where closed_by = 'agent' and not is_backfill
        ) else (
          select extract(epoch from avg(closed_at - opened_at))
          from closed_period_tickets
          where closed_by = 'agent' and not is_backfill
        ) end
      ) as tma_seconds,
      (
        case when p_business_hours then (
          select extract(epoch from avg(public.business_hours_elapsed(p_account_id, opened_at, first_response_at)))
          from period_tickets
          where initiated_by = 'customer' and first_response_at is not null and not is_backfill
        ) else (
          select extract(epoch from avg(first_response_at - opened_at))
          from period_tickets
          where initiated_by = 'customer' and first_response_at is not null and not is_backfill
        ) end
      ) as first_response_seconds
  ),
  by_channel as (
    select coalesce(jsonb_agg(jsonb_build_object('channel_id', ch_id, 'channel_name', ch_name, 'count', cnt) order by cnt desc), '[]'::jsonb) as data
    from (
      select wc.id as ch_id, wc.name as ch_name, count(*) as cnt
      from period_tickets pt
      join public.conversations c on c.id = pt.conversation_id
      left join public.whatsapp_channels wc on wc.id = c.channel_id
      group by wc.id, wc.name
    ) x
  ),
  by_source as (
    select coalesce(jsonb_agg(jsonb_build_object('source', src, 'count', cnt) order by cnt desc), '[]'::jsonb) as data
    from (
      select source as src, count(*) as cnt
      from period_tickets
      group by source
    ) x
  ),
  by_closing_reason as (
    select coalesce(jsonb_agg(jsonb_build_object('closing_reason_id', cr_id, 'label', cr_label, 'count', cnt) order by cnt desc), '[]'::jsonb) as data
    from (
      select cr.id as cr_id, cr.label as cr_label, count(*) as cnt
      from closed_period_tickets t
      left join public.closing_reasons cr on cr.id = t.closing_reason_id
      where not t.is_backfill
      group by cr.id, cr.label
    ) x
  ),
  by_department as (
    select coalesce(jsonb_agg(jsonb_build_object('department_id', dep_id, 'name', dep_name, 'count', cnt) order by cnt desc), '[]'::jsonb) as data
    from (
      select d.id as dep_id, d.name as dep_name, count(*) as cnt
      from period_tickets t
      left join public.departments d on d.id = t.department_id
      group by d.id, d.name
    ) x
  ),
  by_day as (
    select coalesce(jsonb_agg(jsonb_build_object('date', day, 'count', cnt) order by day), '[]'::jsonb) as data
    from (
      select (opened_at at time zone v_tz)::date as day, count(*) as cnt
      from period_tickets
      group by (opened_at at time zone v_tz)::date
    ) x
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'user_id', p_user_id,
      'department_id', p_department_id,
      'channel_id', p_channel_id,
      'timezone', v_tz,
      'business_hours', p_business_hours,
      'business_hours_configured', v_bh_configured
    ),
    'cards', (select row_to_json(cards)::jsonb from cards),
    'charts', jsonb_build_object(
      'by_channel', (select data from by_channel),
      'by_source', (select data from by_source),
      'by_closing_reason', (select data from by_closing_reason),
      'by_department', (select data from by_department),
      'daily', (select data from by_day)
    )
  )
  into v_result;

  return v_result;
end;
$$;

alter function public.get_ticket_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid, boolean) owner to postgres;
grant execute on function public.get_ticket_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid, boolean) to authenticated, service_role;
