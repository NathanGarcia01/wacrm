-- ============================================================
-- 077_get_ticket_dashboard.sql
--
-- Fase 3 (dashboards) — Etapa 2: get_ticket_dashboard(), a função
-- principal do Dash de Atendimento. Primeira versão só em tempo
-- corrido (closed_at - opened_at / first_response_at - opened_at em
-- wall-clock) — o toggle "horas úteis" (business_hours_elapsed,
-- migration 076) entra depois, não nesta etapa.
--
-- Filtros: período (p_start/p_end, timestamptz), usuário
-- (assigned_agent_id), departamento e canal.
--
-- Bases de dados diferentes por métrica, todas com os mesmos filtros
-- de usuário/departamento/canal aplicados:
--   - period_tickets: opened_at dentro do período — base de "Total de
--     atendimentos", iniciados por cliente/empresa, atendentes
--     distintos, contatos atendidos, 1ª resposta e dos gráficos de
--     canal/origem/departamento/evolução diária.
--   - current_status_tickets: status atual (pending/in_progress),
--     IGNORA o período de propósito — é uma fila viva, não um corte
--     histórico.
--   - closed_period_tickets: closed_at dentro do período — base do
--     TMA e do gráfico de motivo de fechamento (fechar é o evento que
--     importa pra essas duas métricas, não a abertura).
--
-- is_backfill = true fica fora de TMA, 1ª resposta e motivo de
-- fechamento (dados reconstruídos sem first_response_at real e sem
-- motivo real — ver migration 072). Continua contando em "Total de
-- atendimentos" e nos gráficos de canal/origem/departamento/evolução,
-- que representam volume histórico real, não precisão de SLA.
--
-- "Novos contatos" é a única métrica que NÃO aplica os filtros de
-- usuário/departamento/canal — é contacts.created_at no período, sem
-- nenhuma relação com ticket (um contato não tem canal/departamento
-- próprio, só as conversas que ele tem).
--
-- SECURITY DEFINER + is_account_member manual + search_path fixo,
-- mesmo padrão de list_inbox_tab_conversations/get_inbox_tab_counts
-- (migration 075): postgres é owner das tabelas e por isso ignora RLS
-- quando a função roda como DEFINER, então o guard explícito é quem
-- garante que só membros da própria conta vejam os próprios dados.
--
-- Índices novos: idx_tickets_account_opened cobre o caso mais comum
-- (sem filtro de usuário/departamento) pro corte por opened_at — as
-- composições com agent/department já existiam (migration 070).
-- idx_tickets_account_status_closed_at (migration 075) já cobre
-- closed_period_tickets. idx_contacts_account_created cobre "novos
-- contatos".
-- ============================================================

create index if not exists idx_tickets_account_opened
  on public.tickets(account_id, opened_at);

create index if not exists idx_contacts_account_created
  on public.contacts(account_id, created_at);

create or replace function public.get_ticket_dashboard(
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
  v_result jsonb;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select timezone into v_tz from public.accounts where id = p_account_id;
  if v_tz is null then
    v_tz := 'America/Sao_Paulo';
  end if;

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
        select extract(epoch from avg(closed_at - opened_at))
        from closed_period_tickets
        where closed_by = 'agent' and not is_backfill
      ) as tma_seconds,
      (
        select extract(epoch from avg(first_response_at - opened_at))
        from period_tickets
        where initiated_by = 'customer' and first_response_at is not null and not is_backfill
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
      'timezone', v_tz
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

alter function public.get_ticket_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid) owner to postgres;
grant execute on function public.get_ticket_dashboard(uuid, timestamptz, timestamptz, uuid, uuid, uuid) to authenticated, service_role;
