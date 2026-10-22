-- Caixa de entrada redesign (A+C), Parte 1 — list_inbox_tab_conversations
-- (migration 075) builds its JSON rows with an explicit field list, so
-- the two new conversations columns from migration 120
-- (last_message_sender_type, last_customer_message_at) never reached
-- the UI for accounts with tickets_ui_enabled (they go through this RPC,
-- not a plain `select '*'`) — the list's status line silently rendered
-- nothing for them. Same body as 075's function, just the two extra
-- jsonb_build_object fields in both branches.

create or replace function public.list_inbox_tab_conversations(
  p_account_id uuid,
  p_tab text, -- 'pending' | 'in_progress' | 'closed' | 'no_ticket'
  p_user_id uuid default null,
  p_only_mine boolean default false,
  p_unread_only boolean default false,
  p_channel_id uuid default null,
  p_search text default null,
  p_limit int default 30,
  p_offset int default 0
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
        'ticket', to_jsonb(t.*)
      )
      from public.tickets t
      join public.conversations c on c.id = t.conversation_id
      where t.account_id = p_account_id
        and t.status = p_tab
        and (not p_only_mine or t.assigned_agent_id = p_user_id)
        and (p_channel_id is null or c.channel_id = p_channel_id)
        and (not p_unread_only or c.unread_count > 0)
        and (
          p_search is null or p_search = '' or
          c.last_message_text ilike '%' || p_search || '%' or
          exists (
            select 1 from public.contacts ct
            where ct.id = c.contact_id
              and (ct.name ilike '%' || p_search || '%' or ct.phone ilike '%' || p_search || '%')
          )
        )
      order by (case when p_tab = 'closed' then t.closed_at else c.last_message_at end) desc nulls last
      limit p_limit offset p_offset;
  end if;
end;
$$;
