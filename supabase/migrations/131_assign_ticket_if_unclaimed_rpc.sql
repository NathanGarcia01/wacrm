-- ============================================================
-- 131_assign_ticket_if_unclaimed_rpc.sql
--
-- Fase 1 (distribuição automática de tickets) — Etapa 2, correção:
-- o ciclo automático (src/lib/routing/cycle.ts via
-- assignTicketIfUnclaimed) só atualizava `tickets`, nunca
-- `conversations.assigned_agent_id` — o campo que a Inbox de fato lê
-- (ver /api/conversations/[id]/assign, o caminho manual, que grava
-- a conversa e espelha no ticket). Resultado: um ticket roteado
-- automaticamente ficava com dono no ticket mas "sem dono" na Inbox.
-- Não existe (e nunca existiu) trigger de banco sincronizando os
-- dois campos — confirmado lendo 001_initial_schema.sql, 017 e 070.
--
-- Escolha: função SQL (SECURITY DEFINER) com as duas UPDATEs numa
-- única chamada, em vez de dois UPDATEs via PostgREST + reversão
-- manual do lado da aplicação. Motivo: uma função plpgsql é UMA
-- transação do ponto de vista do Postgres — ou as duas tabelas
-- mudam juntas, ou nenhuma muda; não existe round-trip de "desfazer"
-- que possa falhar sozinho. Um reverte-se-falhar em TypeScript
-- precisaria de uma SEGUNDA chamada de rede (o UPDATE de volta do
-- ticket para pending) que também pode cair/der timeout, deixando o
-- ticket preso num estado "atribuído mas não deveria estar" sem
-- nenhum motivo visível e sem chance de nova tentativa (ele já não
-- é mais pending+sem-dono, então o próximo ciclo o ignora para
-- sempre). A função elimina essa janela.
--
-- Mesma trava de concorrência do UPDATE condicional em
-- assignTicketIfUnclaimed (agora dentro da função): só reivindica o
-- ticket se ele ainda estiver pending e sem dono; só espelha no
-- conversations se ela ainda estiver sem dono (nunca sobrescreve uma
-- atribuição manual anterior — mesma regra do ajuste pedido).
--
-- `returns setof tickets` (não `table(...)`) para devolver a linha
-- inteira sem reescrever cada coluna — PostgREST serializa isso como
-- array (0 ou 1 elemento), igual a qualquer função SETOF.
-- ============================================================

create or replace function public.assign_ticket_if_unclaimed(
  p_ticket_id uuid,
  p_agent_id uuid
)
returns setof public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
begin
  -- Só o ciclo automático (service-role, sem usuário logado) chama
  -- esta função — mesma guarda de next_ticket_protocol (migration 070).
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  update public.tickets
  set assigned_agent_id = p_agent_id, status = 'in_progress'
  where id = p_ticket_id
    and status = 'pending'
    and assigned_agent_id is null
  returning * into v_ticket;

  -- Perdeu a corrida (outro ciclo ou uma atribuição manual chegou
  -- primeiro) — nenhuma linha em tickets OU conversations é tocada.
  if v_ticket.id is null then
    return;
  end if;

  update public.conversations
  set assigned_agent_id = p_agent_id
  where id = v_ticket.conversation_id
    and account_id = v_ticket.account_id
    and assigned_agent_id is null;

  return next v_ticket;
end;
$$;

alter function public.assign_ticket_if_unclaimed(uuid, uuid) owner to postgres;
grant execute on function public.assign_ticket_if_unclaimed(uuid, uuid) to service_role;
