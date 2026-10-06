-- ============================================================
-- 079_ticket_dashboard_refinements.sql
--
-- Fase 3 (dashboards) — acabamento no Dash de Atendimento (Etapa 4,
-- feedback do front já em produção):
--
-- 1) O gráfico "Atendimentos por dia" virava um ponto único e inútil
--    quando o período é "hoje" (1 dia corrido) — agora agrupa por
--    HORA (no fuso da conta) sempre que o período cobre <= 1 dia, e
--    por dia do calendário caso contrário. `filters.granularity`
--    ('hour' | 'day') entra no retorno pra o front saber como
--    formatar o eixo sem ter que inferir pelo próprio intervalo.
--
-- 2) "Novos contatos" misturava cadastro em massa pra disparo
--    (import-modal.tsx insere direto em `contacts`, sem conversa
--    nenhuma) com contato que de fato trocou mensagem — o número
--    inflava sem dizer nada sobre atendimento real. Agora o card
--    reporta `new_contacts_engaged` (criado no período E com uma
--    mensagem do cliente no período) separado de `new_contacts`
--    (todos os cadastros no período, inclusive os de import) — o
--    front mostra o engajado como card e o total só no tooltip.
--    Mesma regra de antes: não aplica os filtros de usuário/
--    departamento/canal (um contato não pertence a nenhum deles
--    diretamente).
--
-- Mesma assinatura da migration 078 (nenhum parâmetro novo) — CREATE
-- OR REPLACE substitui a função existente sem precisar de DROP.
-- ============================================================

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
  v_hourly boolean;
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

  v_hourly := (p_end - p_start) <= interval '1 day';

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
        select count(*) from public.contacts ct
        where ct.account_id = p_account_id
          and ct.created_at >= p_start and ct.created_at < p_end
          and exists (
            select 1
            from public.conversations c
            join public.messages m on m.conversation_id = c.id
            where c.contact_id = ct.id
              and m.sender_type = 'customer'
              and m.created_at >= p_start and m.created_at < p_end
          )
      ) as new_contacts_engaged,
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
    select coalesce(jsonb_agg(jsonb_build_object('date', bucket, 'count', cnt) order by bucket), '[]'::jsonb) as data
    from (
      select
        case when v_hourly
          then to_char(date_trunc('hour', opened_at at time zone v_tz), 'YYYY-MM-DD"T"HH24:00:00')
          else to_char((opened_at at time zone v_tz)::date, 'YYYY-MM-DD')
        end as bucket,
        count(*) as cnt
      from period_tickets
      group by 1
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
      'business_hours_configured', v_bh_configured,
      'granularity', case when v_hourly then 'hour' else 'day' end
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
