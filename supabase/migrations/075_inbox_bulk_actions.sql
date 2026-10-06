-- ============================================================
-- 075_inbox_bulk_actions.sql
--
-- Fase 1 (atendimento) — correção da inbox: a lista hoje busca TODAS
-- as conversas da conta num fetch só, sem `.range()`, e filtra em
-- memória — o PostgREST corta em 1000 linhas por padrão, o que já
-- estourou numa conta com 3964 conversas (contador "Sem atendimento"
-- travado em 1000, e risco de tickets abertos ficarem de fora da
-- aba certa se não estiverem entre as 1000 mais recentes).
--
-- Duas funções novas, SECURITY DEFINER, account-scoped via
-- is_account_member (mesmo padrão de next_ticket_protocol):
--
--   - list_inbox_tab_conversations: uma página (limit/offset) de
--     conversas pra uma aba (pending/in_progress/closed/no_ticket),
--     com os mesmos filtros que a UI já tinha (canal, busca, só os
--     meus, não lidas) — resolvidos no banco, não no browser. Usada
--     tanto pra renderizar a lista quanto, em lotes de até 200, pra
--     resolver "selecionar todos os N" nas ações em massa.
--   - get_inbox_tab_counts: os 4 contadores de aba num count(*) só
--     por aba, nunca dependendo de quantas linhas a lista carregou.
--
-- Ordenação — "pending"/"in_progress" por conversations.last_message_at
-- (não tickets.opened_at): uma mensagem nova precisa subir a conversa
-- pro topo da aba mesmo sem o ciclo de atendimento ter mudado de
-- status, senão "nova mensagem move pro topo" (comportamento padrão
-- de inbox) não acontece pra quem já está em algum atendimento.
-- "closed" usa closed_at (é um log histórico, não uma fila viva).
-- "no_ticket" (sem linha em tickets — consulta direto em
-- conversations) também por last_message_at.
--
-- Índices novos: idx_tickets_account_status (migration 070) já
-- cobre o filtro account_id+status; o que faltava era um índice
-- com account_id pra ordenar conversations por last_message_at —
-- usado tanto pelo "no_ticket" quanto, via join, por "pending"/
-- "in_progress". "closed" ganha seu próprio índice porque
-- closed_at mora em tickets, não em conversations.
-- ============================================================

create index if not exists idx_tickets_account_status_closed_at
  on public.tickets(account_id, status, closed_at desc)
  where status = 'closed';

create index if not exists idx_conversations_account_last_message
  on public.conversations(account_id, last_message_at desc);

-- ------------------------------------------------------------
-- list_inbox_tab_conversations
-- ------------------------------------------------------------
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
    -- "Só os meus" não faz sentido pra conversa sem ticket (sem
    -- conceito de atendente) — devolve vazio em vez de ignorar o
    -- filtro, pra não mostrar resultado incoerente com o contador
    -- (get_inbox_tab_counts zera esse caso do mesmo jeito).
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

alter function public.list_inbox_tab_conversations(uuid, text, uuid, boolean, boolean, uuid, text, int, int) owner to postgres;
grant execute on function public.list_inbox_tab_conversations(uuid, text, uuid, boolean, boolean, uuid, text, int, int) to authenticated, service_role;

-- ------------------------------------------------------------
-- get_inbox_tab_counts
-- ------------------------------------------------------------
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

  select count(*) into v_pending
  from public.tickets t
  join public.conversations c on c.id = t.conversation_id
  where t.account_id = p_account_id and t.status = 'pending'
    and (not p_only_mine or t.assigned_agent_id = p_user_id)
    and (not p_unread_only or c.unread_count > 0);

  select count(*) into v_in_progress
  from public.tickets t
  join public.conversations c on c.id = t.conversation_id
  where t.account_id = p_account_id and t.status = 'in_progress'
    and (not p_only_mine or t.assigned_agent_id = p_user_id)
    and (not p_unread_only or c.unread_count > 0);

  select count(*) into v_closed
  from public.tickets t
  join public.conversations c on c.id = t.conversation_id
  where t.account_id = p_account_id and t.status = 'closed'
    and (not p_only_mine or t.assigned_agent_id = p_user_id)
    and (not p_unread_only or c.unread_count > 0);

  -- "Só os meus" não existe pra conversa sem ticket — zera em vez de
  -- ignorar o filtro (mesma regra de list_inbox_tab_conversations).
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

alter function public.get_inbox_tab_counts(uuid, uuid, boolean, boolean) owner to postgres;
grant execute on function public.get_inbox_tab_counts(uuid, uuid, boolean, boolean) to authenticated, service_role;
