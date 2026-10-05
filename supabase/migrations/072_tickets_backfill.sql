-- ============================================================
-- 072_tickets_backfill.sql
--
-- Fase 1 (atendimento) — Etapa 5: cria um ticket para cada
-- `conversations` existente que se qualifica, seguindo as MESMAS
-- regras de abertura e atribuição da Etapa 3
-- (src/lib/tickets/lifecycle.ts).
--
-- Elegibilidade (aprovada) — só ganha ticket quem tem pelo menos UMA
-- mensagem que, em produção, teria chamado openTicketIfNeeded:
--   - sender_type = 'customer' (qualquer), OU
--   - sender_type = 'agent' que NÃO seja espelho de broadcast —
--     verificado por NOT EXISTS em broadcast_recipients.whatsapp_
--     message_id = messages.message_id, igual recordAgentReply faz
--     para não confundir resposta manual com disparo de campanha
--     (ambos gravam sender_type='agent' em messages; só o espelho
--     tem uma linha correspondente em broadcast_recipients).
-- Mensagens sender_type='bot' (automação/fluxo) nunca contam.
-- Conversa sem nenhuma mensagem elegível é PULADA — nunca teve
-- resposta, só recebeu broadcast/automação/fluxo, não faz sentido
-- abrir ticket (mesma regra que o webhook/send route já aplicam:
-- só eles chamam openTicketIfNeeded).
--
-- opened_at e atribuição vêm da MESMA mensagem (aprovado):
--   - início do ciclo = coalesce(reopened_at, created_at) da conversa,
--     MENOS 60 segundos. Verificado empiricamente: reopened_at é
--     gravado pelo trigger ~1-10s DEPOIS da própria mensagem do
--     cliente que reabriu a conversa (latência do trigger/update),
--     então um filtro >= reopened_at exato jogava fora essa mensagem
--     e classificava erroneamente a reabertura como manual_outbound
--     (atendente) quando na real foi o cliente quem reabriu. A
--     margem de 60s é generosa o suficiente pra cobrir essa latência
--     sem puxar mensagens de um ciclo anterior de volta pro ciclo
--     atual (gaps observados: 118 de 145 casos ficam entre 1-10s).
--   - mensagem elegível = a primeira elegível com created_at >= início
--     do ciclo (já com a margem); se não houver nenhuma dentro do
--     ciclo atual (ex.: conversa reaberta só por automação/bot depois
--     do reopened_at), cai pra primeira elegível da conversa inteira,
--     sem o filtro.
--   - opened_at do ticket = created_at dessa mensagem (não mais o
--     created_at/reopened_at da conversa).
-- Atribuição de source/initiated_by replicando resolveInboundTicketAttribution,
-- calculada a partir dessa MESMA mensagem:
--   - elegível é 'agent'    -> initiated_by='company',  source='manual_outbound'
--   - elegível é 'customer' -> initiated_by='customer'; se existir um
--     broadcast_recipients.sent_at para o mesmo contato nas 72h
--     ANTERIORES a essa mensagem (CAMPAIGN_ATTRIBUTION_WINDOW_HOURS
--     em lifecycle.ts), source='campaign' + campaign_id=broadcast_id;
--     senão source='inbound'.
-- source='automation' não é usado — a Etapa 3 não popula esse valor
-- hoje (lifecycle.ts linha ~191), então o backfill também não.
--
-- Limitações assumidas (aprovadas no plano da Fase 1 — não há como
-- fazer melhor com os dados que existem):
--   - Esta base guarda UMA conversa por (account, contact) para
--     sempre (findOrCreateConversation reaproveita a linha) e só
--     marca a transição fechado→aberto mais recente em
--     `reopened_at` (migration 059) — não o histórico completo de
--     ciclos. Então cada conversa elegível recebe exatamente 1
--     ticket aqui, não 1 por ciclo real de atendimento; ciclos
--     anteriores ao último `reopened_at` são irrecuperáveis.
--   - closed_at não existe em `conversations` — usa `updated_at` como
--     aproximação para tickets já fechados.
--   - Tickets fechados aqui usam o motivo de sistema
--     'no_reason_informed' (migration 071) com closed_by='system' —
--     o motivo real de fechamento, se algum dia existiu, não foi
--     registrado em lugar nenhum antes desta Fase 1.
--   - first_response_at fica NULL — não há como reconstruir o
--     timestamp real da primeira resposta do agente de forma
--     confiável para histórico; é exatamente por isso que a coluna
--     is_backfill (abaixo) existe, para os dashboards excluírem este
--     lote das métricas de TMA/1ª resposta/motivo de fechamento.
--
-- is_backfill: nova coluna em tickets, boolean not null default
-- false. Todo ticket criado por esta migration grava is_backfill=
-- true, para diferenciar do histórico reconstruído (sem
-- first_response_at e sem motivo de fechamento real) dos tickets
-- gerados pelo ciclo de vida real (Etapa 4) nas métricas.
--
-- protocol_number sai de account_ticket_counters na ordem de
-- opened_at (coalesce(reopened_at, created_at)) dentro de cada conta
-- — mesma função que next_ticket_protocol() usa, só sem passar pela
-- checagem de role da RPC (não faz sentido aqui: isto roda com
-- privilégio total de administrador do banco, não numa request de
-- client).
--
-- Cada conversa é isolada num BEGIN/EXCEPTION próprio — uma linha com
-- dado inesperado gera um WARNING e é pulada, em vez de abortar o
-- backfill inteiro para todas as outras contas.
--
-- Idempotente — só processa conversas que ainda não têm ticket
-- (`WHERE NOT EXISTS`), então rodar de novo não duplica nada.
-- ============================================================

alter table public.tickets
  add column if not exists is_backfill boolean not null default false;

do $$
declare
  conv record;
  v_protocol bigint;
  v_status text;
  v_closed_at timestamptz;
  v_closing_reason_id uuid;
  v_closed_by text;
  v_initiated_by text;
  v_source text;
  v_campaign_id uuid;
  v_opened_at timestamptz;
  v_cycle_start timestamptz;
  v_first_sender text;
  v_first_msg_at timestamptz;
  v_ticket_id uuid;
begin
  for conv in
    select c.id, c.account_id, c.status, c.assigned_agent_id, c.contact_id,
           c.created_at, c.reopened_at, c.updated_at
    from public.conversations c
    where not exists (select 1 from public.tickets t where t.conversation_id = c.id)
    order by c.account_id, coalesce(c.reopened_at, c.created_at)
  loop
    begin
      v_cycle_start := coalesce(conv.reopened_at, conv.created_at) - interval '60 seconds';

      -- mensagem elegível mais antiga DENTRO do ciclo atual (ver regra
      -- de elegibilidade no cabeçalho); null = nenhuma mensagem
      -- elegível desde que o ciclo começou.
      select m.sender_type, m.created_at
        into v_first_sender, v_first_msg_at
        from public.messages m
        where m.conversation_id = conv.id
          and m.created_at >= v_cycle_start
          and (
            m.sender_type = 'customer'
            or (
              m.sender_type = 'agent'
              and not exists (
                select 1 from public.broadcast_recipients br
                where br.whatsapp_message_id = m.message_id
              )
            )
          )
        order by m.created_at asc
        limit 1;

      -- fallback: nenhuma elegível dentro do ciclo atual -> primeira
      -- elegível da conversa inteira, sem o filtro de ciclo.
      if v_first_sender is null then
        select m.sender_type, m.created_at
          into v_first_sender, v_first_msg_at
          from public.messages m
          where m.conversation_id = conv.id
            and (
              m.sender_type = 'customer'
              or (
                m.sender_type = 'agent'
                and not exists (
                  select 1 from public.broadcast_recipients br
                  where br.whatsapp_message_id = m.message_id
                )
              )
            )
          order by m.created_at asc
          limit 1;
      end if;

      if v_first_sender is null then
        continue;
      end if;

      v_opened_at := v_first_msg_at;
      v_campaign_id := null;

      if v_first_sender = 'agent' then
        v_initiated_by := 'company';
        v_source := 'manual_outbound';
      else
        v_initiated_by := 'customer';

        select br.broadcast_id into v_campaign_id
          from public.broadcast_recipients br
          where br.contact_id = conv.contact_id
            and br.sent_at is not null
            and br.sent_at >= (v_first_msg_at - interval '72 hours')
            and br.sent_at <= v_first_msg_at
          order by br.sent_at desc
          limit 1;

        v_source := case when v_campaign_id is not null then 'campaign' else 'inbound' end;
      end if;

      if conv.status = 'closed' then
        v_status := 'closed';
        v_closed_at := conv.updated_at;
        v_closed_by := 'system';
        select id into v_closing_reason_id
          from public.closing_reasons
          where account_id = conv.account_id and is_system and system_key = 'no_reason_informed';
        if v_closing_reason_id is null then
          raise exception 'No no_reason_informed system closing reason for account % — did migration 071 run?', conv.account_id;
        end if;
      else
        v_status := case when conv.assigned_agent_id is not null then 'in_progress' else 'pending' end;
        v_closed_at := null;
        v_closing_reason_id := null;
        v_closed_by := null;
      end if;

      insert into public.account_ticket_counters (account_id, last_number)
      values (conv.account_id, 1)
      on conflict (account_id) do update
        set last_number = account_ticket_counters.last_number + 1
      returning last_number into v_protocol;

      -- created_at is left to its own default (now()) on purpose — it
      -- means "when was this row created", which for a backfilled row
      -- really is now, not back-dated like opened_at/closed_at are.
      insert into public.tickets (
        account_id, conversation_id, protocol_number, status,
        initiated_by, source, campaign_id, assigned_agent_id,
        opened_at, closed_at, closing_reason_id, closed_by, is_backfill
      ) values (
        conv.account_id, conv.id, v_protocol, v_status,
        v_initiated_by, v_source, v_campaign_id, conv.assigned_agent_id,
        v_opened_at, v_closed_at, v_closing_reason_id, v_closed_by, true
      )
      returning id into v_ticket_id;

      insert into public.ticket_events (ticket_id, account_id, type, actor_id, metadata, created_at)
      values (v_ticket_id, conv.account_id, 'opened', null, jsonb_build_object('backfill', true), v_opened_at);

      if v_status = 'closed' then
        insert into public.ticket_events (ticket_id, account_id, type, actor_id, metadata, created_at)
        values (
          v_ticket_id, conv.account_id, 'closed', null,
          jsonb_build_object(
            'backfill', true,
            'closing_reason_id', v_closing_reason_id,
            'closed_by', v_closed_by
          ),
          v_closed_at
        );
      end if;
    exception when others then
      raise warning 'Skipping conversation % (account %) in tickets backfill: %', conv.id, conv.account_id, sqlerrm;
    end;
  end loop;
end $$;
