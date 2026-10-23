-- Caixa de entrada — dois bugs de dado achados ao revisar a Parte 2:
--
-- 1) list_inbox_tab_conversations/get_inbox_tab_counts joined tickets 1
--    para N com conversations sem desduplicar: uma conversa com várias
--    ciclos de atendimento fechados (reabre/fecha várias vezes) voltava
--    uma linha POR TICKET, não uma por conversa — "Fechados" mostrava
--    a mesma conversa repetida e o contador (1698 tickets) inflado
--    contra o real (1639 conversas distintas). Corrigido com
--    row_number() por conversation_id, pegando o ticket mais recente
--    (closed_at desc) — pending/in_progress já eram 1:1 na prática, mas
--    o mesmo padrão evita o problema se algum dia deixarem de ser.
--
-- 2) O filtro "Aguardando"/"Expirando" (migration 124) não excluía
--    tickets fechados — como conversations.status fica 'open' mesmo
--    com o ticket fechado (conversations.status e tickets.status são
--    independentes), uma mensagem de bot de encerramento (ex.: pesquisa
--    NPS) marcava bot_awaiting_human=true e a conversa aparecia
--    vermelha "Esperando atendente" mesmo já fechada. Dentro desta RPC,
--    "está fechada" é simplesmente p_tab = 'closed' (uma linha só
--    aparece nesse branch se o ticket dela está fechado) — não precisa
--    de coluna nova.

create or replace function public.get_inbox_tab_counts(
  p_account_id uuid,
  p_user_id uuid default null,
  p_only_mine boolean default false,
  p_unread_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_in_progress int;
  v_closed int;
  v_no_ticket int;
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select count(DISTINCT t.conversation_id) into v_pending
  from public.tickets t
  join public.conversations c on c.id = t.conversation_id
  where t.account_id = p_account_id and t.status = 'pending'
    and (not p_only_mine or t.assigned_agent_id = p_user_id)
    and (not p_unread_only or c.unread_count > 0);

  select count(DISTINCT t.conversation_id) into v_in_progress
  from public.tickets t
  join public.conversations c on c.id = t.conversation_id
  where t.account_id = p_account_id and t.status = 'in_progress'
    and (not p_only_mine or t.assigned_agent_id = p_user_id)
    and (not p_unread_only or c.unread_count > 0);

  select count(DISTINCT t.conversation_id) into v_closed
  from public.tickets t
  join public.conversations c on c.id = t.conversation_id
  where t.account_id = p_account_id and t.status = 'closed'
    and (not p_only_mine or t.assigned_agent_id = p_user_id)
    and (not p_unread_only or c.unread_count > 0);

  if p_only_mine then
    v_no_ticket := 0;
  else
    select count(*) into v_no_ticket
    from public.conversations c
    where c.account_id = p_account_id
      and not exists (select 1 from public.tickets t where t.conversation_id = c.id)
      and (not p_unread_only or c.unread_count > 0);
  end if;

  return jsonb_build_object(
    'pending', v_pending,
    'in_progress', v_in_progress,
    'closed', v_closed,
    'no_ticket', v_no_ticket
  );
end;
$$;

create or replace function public.list_inbox_tab_conversations(
  p_account_id uuid,
  p_tab text,
  p_user_id uuid default null,
  p_only_mine boolean default false,
  p_unread_only boolean default false,
  p_channel_id uuid default null,
  p_search text default null,
  p_limit int default 30,
  p_offset int default 0,
  p_expiring_only boolean default false,
  p_awaiting_only boolean default false
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;
  if p_tab not in ('pending', 'in_progress', 'closed', 'no_ticket') then
    raise exception 'invalid tab: %', p_tab;
  end if;

  if p_tab = 'no_ticket' then
    if p_only_mine then
      return;
    end if;
    return query
      select jsonb_build_object(
        'id', c.id,
        'account_id', c.account_id,
        'contact_id', c.contact_id,
        'status', c.status,
        'assigned_agent_id', c.assigned_agent_id,
        'last_message_text', c.last_message_text,
        'last_message_at', c.last_message_at,
        'last_message_sender_type', c.last_message_sender_type,
        'last_customer_message_at', c.last_customer_message_at,
        'bot_awaiting_human', c.bot_awaiting_human,
        'unread_count', c.unread_count,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'reopened_at', c.reopened_at,
        'channel_id', c.channel_id,
        'contact', (
          select jsonb_build_object('id', ct.id, 'name', ct.name, 'phone', ct.phone, 'avatar_url', ct.avatar_url)
          from public.contacts ct where ct.id = c.contact_id
        ),
        'channel', (
          select jsonb_build_object('name', wc.name, 'display_phone_number', wc.display_phone_number, 'channel_type', wc.channel_type)
          from public.whatsapp_channels wc where wc.id = c.channel_id
        ),
        'ticket', null
      )
      from public.conversations c
      where c.account_id = p_account_id
        and not exists (select 1 from public.tickets t where t.conversation_id = c.id)
        and (p_channel_id is null or c.channel_id = p_channel_id)
        and (not p_unread_only or c.unread_count > 0)
        and (not p_awaiting_only or (
          c.status <> 'closed'
          and (c.last_message_sender_type = 'customer' or c.bot_awaiting_human)
        ))
        and (not p_expiring_only or (
          c.status <> 'closed'
          and c.last_message_sender_type is distinct from 'customer'
          and not c.bot_awaiting_human
          and c.last_customer_message_at is not null
          and now() - c.last_customer_message_at >= interval '20 hours'
          and now() - c.last_customer_message_at < interval '24 hours'
        ))
        and (
          p_search is null or p_search = '' or
          c.last_message_text ilike '%' || p_search || '%' or
          exists (
            select 1 from public.contacts ct
            where ct.id = c.contact_id
              and (ct.name ilike '%' || p_search || '%' or ct.phone ilike '%' || p_search || '%')
          )
        )
      order by c.last_message_at desc nulls last
      limit p_limit offset p_offset;
  else
    -- One row per CONVERSATION, not per ticket — a conversation can
    -- have several closed tickets (reopen/close cycles); pick the most
    -- relevant one for this tab (closed: most recently closed;
    -- pending/in_progress: most recently opened — always exactly one
    -- in practice, but row_number() makes that an invariant instead of
    -- an assumption).
    return query
      with ranked_tickets as (
        select
          t.id as ticket_id,
          t.conversation_id,
          t.assigned_agent_id as ticket_assigned_agent_id,
          t.closed_at,
          row_number() over (
            partition by t.conversation_id
            order by t.closed_at desc nulls last, t.opened_at desc
          ) as rn
        from public.tickets t
        where t.account_id = p_account_id
          and t.status = p_tab
      )
      select jsonb_build_object(
        'id', c.id,
        'account_id', c.account_id,
        'contact_id', c.contact_id,
        'status', c.status,
        'assigned_agent_id', c.assigned_agent_id,
        'last_message_text', c.last_message_text,
        'last_message_at', c.last_message_at,
        'last_message_sender_type', c.last_message_sender_type,
        'last_customer_message_at', c.last_customer_message_at,
        'bot_awaiting_human', c.bot_awaiting_human,
        'unread_count', c.unread_count,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'reopened_at', c.reopened_at,
        'channel_id', c.channel_id,
        'contact', (
          select jsonb_build_object('id', ct.id, 'name', ct.name, 'phone', ct.phone, 'avatar_url', ct.avatar_url)
          from public.contacts ct where ct.id = c.contact_id
        ),
        'channel', (
          select jsonb_build_object('name', wc.name, 'display_phone_number', wc.display_phone_number, 'channel_type', wc.channel_type)
          from public.whatsapp_channels wc where wc.id = c.channel_id
        ),
        'ticket', (select to_jsonb(t2.*) from public.tickets t2 where t2.id = rt.ticket_id)
      )
      from ranked_tickets rt
      join public.conversations c on c.id = rt.conversation_id
      where rt.rn = 1
        and (not p_only_mine or rt.ticket_assigned_agent_id = p_user_id)
        and (p_channel_id is null or c.channel_id = p_channel_id)
        and (not p_unread_only or c.unread_count > 0)
        -- p_tab = 'closed' ⇒ every row here IS a closed ticket by
        -- construction — never match Aguardando/Expirando for them,
        -- regardless of conversations.status (which tracks something
        -- independent of the ticket lifecycle).
        and (not p_awaiting_only or (
          p_tab <> 'closed'
          and (c.last_message_sender_type = 'customer' or c.bot_awaiting_human)
        ))
        and (not p_expiring_only or (
          p_tab <> 'closed'
          and c.last_message_sender_type is distinct from 'customer'
          and not c.bot_awaiting_human
          and c.last_customer_message_at is not null
          and now() - c.last_customer_message_at >= interval '20 hours'
          and now() - c.last_customer_message_at < interval '24 hours'
        ))
        and (
          p_search is null or p_search = '' or
          c.last_message_text ilike '%' || p_search || '%' or
          exists (
            select 1 from public.contacts ct
            where ct.id = c.contact_id
              and (ct.name ilike '%' || p_search || '%' or ct.phone ilike '%' || p_search || '%')
          )
        )
      order by (case when p_tab = 'closed' then rt.closed_at else c.last_message_at end) desc nulls last
      limit p_limit offset p_offset;
  end if;
end;
$$;
