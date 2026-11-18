-- ============================================================
-- 133_radar.sql
--
-- Fase 2 (Radar + Follow-up seguro) — Etapa A: tela 100% leitura
-- listando conversas abertas que correm risco de ficar sem resposta.
-- Nenhuma mensagem é enviada por este schema; nenhum dado existente
-- é alterado.
--
-- Três peças:
--   1. radar_settings — limites (horas) configuráveis por conta.
--      Mesmo padrão RLS de routing_settings (migration 129): SELECT
--      para membro da conta, SEM policy de escrita para
--      `authenticated` — toda escrita passa por rota server-side via
--      supabaseAdmin() (service_role bypassa RLS).
--   2. is_contact_opted_out — função única reaproveitada pela Etapa B.
--      Opt-out tem DUAS fontes, não uma: `blocked_phones` ativo
--      (keyword digitada em texto livre, ou as outras origens
--      automáticas) E cliques em botão de template "SAIR"/"NÃO SOU A
--      PESSOA" (broadcast_recipients.button_clicked) — hoje um clique
--      de botão NUNCA grava blocked_phones (bug de produto separado,
--      não corrigido nesta migration; blocked_phones tem 0 linhas em
--      produção contra 395+109 cliques desses dois botões). Até esse
--      bug ser corrigido, qualquer leitor de opt-out que considerasse
--      só blocked_phones estaria ignorando a esmagadora maioria dos
--      pedidos reais de parar — por isso a função já olha as duas
--      fontes desde já.
--   3. get_radar_conversations — a consulta paginada em si, UNION ALL
--      de dois grupos (aguardando resposta / cliente esfriou).
--
-- Segurança de get_radar_conversations: a função NÃO recebe
-- p_user_id/p_is_admin — quem decide "o quê este chamador pode ver"
-- é a rota /api/radar (via requireRole), nunca a função. Isso só é
-- seguro porque EXECUTE é revogado de PUBLIC/anon/authenticated e
-- concedido só a service_role (mesmo padrão de
-- assign_ticket_if_unclaimed, migrations 131/132) — sem isso, qualquer
-- usuário autenticado poderia chamar a função com o account_id de
-- OUTRA conta e ler as conversas de risco de todo mundo. A guarda
-- `auth.role() <> 'service_role'` dentro da função é a segunda
-- camada (mesmo padrão de next_ticket_protocol/assign_ticket_if_unclaimed)
-- — is_account_member() não serve aqui porque auth.uid() é null para
-- service_role.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- radar_settings
-- ------------------------------------------------------------
create table if not exists public.radar_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  waiting_hours numeric not null default 2 check (waiting_hours > 0),
  cooled_hours numeric not null default 24 check (cooled_hours > 0),
  updated_at timestamptz not null default now()
);

alter table public.radar_settings enable row level security;

drop policy if exists radar_settings_select on public.radar_settings;
create policy radar_settings_select on public.radar_settings
  for select to authenticated
  using (is_account_member(account_id));

-- ------------------------------------------------------------
-- is_contact_opted_out — reaproveitada pela Etapa B (follow-up nunca
-- dispara para quem está aqui). `language sql stable` (não plpgsql):
-- função de uma única expressão, candidata a inlining pelo planner
-- quando usada dentro de WHERE NOT is_contact_opted_out(...), então
-- não perde os índices que a consulta chamadora já usa.
--
-- Normalização sem a extensão `unaccent` (não instalada neste
-- projeto): upper(trim(...)) comparado contra as duas grafias
-- ('NAO SOU A PESSOA' e 'NÃO SOU A PESSOA') — suficiente pros únicos
-- dois rótulos de botão que importam aqui, não é um normalizador
-- genérico.
--
-- EXECUTE restrito a service_role (mesmo raciocínio de
-- get_radar_conversations abaixo) — embora o retorno seja só um
-- boolean (não expõe linha nenhuma), é chamada exclusivamente por
-- contextos de servidor (ciclo de follow-up, rota /api/radar), então
-- não há motivo para abrir pra authenticated.
-- ------------------------------------------------------------
create or replace function public.is_contact_opted_out(
  p_account_id uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.blocked_phones bp
    join public.contacts ct on ct.phone_normalized = bp.phone_normalized
    where bp.account_id = p_account_id
      and ct.id = p_contact_id
      and bp.unblocked_at is null
  )
  or exists (
    select 1
    from public.broadcast_recipients br
    join public.broadcasts b on b.id = br.broadcast_id
    where b.account_id = p_account_id
      and br.contact_id = p_contact_id
      and upper(trim(coalesce(br.button_clicked, ''))) in ('SAIR', 'NAO SOU A PESSOA', 'NÃO SOU A PESSOA')
  );
$$;

revoke all on function public.is_contact_opted_out(uuid, uuid) from public;
revoke all on function public.is_contact_opted_out(uuid, uuid) from anon, authenticated;
grant execute on function public.is_contact_opted_out(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- get_radar_conversations — paginada, dois grupos via UNION ALL.
--
-- p_assigned_agent_id: escopo resolvido pela ROTA, não pela função —
-- para um agente comum a rota sempre passa o próprio user_id
-- (força); para admin+ a rota passa o filtro opcional escolhido na
-- tela, ou null (todos os agentes). A função não sabe nem precisa
-- saber qual é o papel de quem pediu — só aplica o filtro que já
-- chegou resolvido.
--
-- p_min_hours: filtro "tempo" da tela — mínimo de horas paradas,
-- por cima do limite padrão de cada grupo (GREATEST), nunca por
-- baixo (não dá pra "ver mais cedo" do que o grupo já define).
--
-- "Aberta" = conversations.status <> 'closed' — verificado contra o
-- dado real de produção (339 conversas), não contra tickets; ver
-- decisão registrada na conversa que aprovou esta etapa.
-- ------------------------------------------------------------
create or replace function public.get_radar_conversations(
  p_account_id uuid,
  p_assigned_agent_id uuid default null,
  p_group text default null,
  p_min_hours numeric default null,
  p_waiting_hours numeric default 2,
  p_cooled_hours numeric default 24,
  p_limit int default 50,
  p_offset int default 0
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_group is not null and p_group not in ('awaiting_us', 'customer_cooled') then
    raise exception 'invalid group: %', p_group;
  end if;

  return query
  select jsonb_build_object(
    'id', x.id,
    'contact_id', x.contact_id,
    'contact_name', x.contact_name,
    'contact_phone', x.contact_phone,
    'assigned_agent_id', x.assigned_agent_id,
    'agent_name', coalesce(p.full_name, p.email),
    'last_message_at', x.last_message_at,
    'last_message_sender_type', x.last_message_sender_type,
    'last_customer_message_at', x.last_customer_message_at,
    'group', x.rgroup
  )
  from (
    select c.id, c.contact_id, ct.name as contact_name, ct.phone as contact_phone,
           c.assigned_agent_id, c.last_message_at, c.last_message_sender_type,
           c.last_customer_message_at, 'awaiting_us'::text as rgroup
    from public.conversations c
    join public.contacts ct on ct.id = c.contact_id
    where c.account_id = p_account_id
      and c.status <> 'closed'
      and coalesce(ct.is_internal, false) = false
      and (p_assigned_agent_id is null or c.assigned_agent_id = p_assigned_agent_id)
      and (p_group is null or p_group = 'awaiting_us')
      and c.last_message_sender_type = 'customer'
      and c.last_message_at < now() - make_interval(hours => greatest(p_waiting_hours, coalesce(p_min_hours, 0)))
      and not public.is_contact_opted_out(p_account_id, c.contact_id)

    union all

    select c.id, c.contact_id, ct.name, ct.phone,
           c.assigned_agent_id, c.last_message_at, c.last_message_sender_type,
           c.last_customer_message_at, 'customer_cooled'::text
    from public.conversations c
    join public.contacts ct on ct.id = c.contact_id
    where c.account_id = p_account_id
      and c.status <> 'closed'
      and coalesce(ct.is_internal, false) = false
      and (p_assigned_agent_id is null or c.assigned_agent_id = p_assigned_agent_id)
      and (p_group is null or p_group = 'customer_cooled')
      and c.last_message_sender_type in ('agent', 'bot')
      and c.last_message_at < now() - make_interval(hours => greatest(p_cooled_hours, coalesce(p_min_hours, 0)))
      and not public.is_contact_opted_out(p_account_id, c.contact_id)
  ) x
  left join public.profiles p on p.user_id = x.assigned_agent_id
  order by x.last_message_at asc
  limit p_limit offset p_offset;
end;
$$;

alter function public.get_radar_conversations(uuid, uuid, text, numeric, numeric, numeric, int, int) owner to postgres;
revoke all on function public.get_radar_conversations(uuid, uuid, text, numeric, numeric, numeric, int, int) from public;
revoke all on function public.get_radar_conversations(uuid, uuid, text, numeric, numeric, numeric, int, int) from anon, authenticated;
grant execute on function public.get_radar_conversations(uuid, uuid, text, numeric, numeric, numeric, int, int) to service_role;
