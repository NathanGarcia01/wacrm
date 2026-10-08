-- ============================================================
-- 104_pipeline_deal_indicators_overdue_tasks.sql
--
-- Fase 6 — decisão 4 dizia "tarefas atrasadas (uma vez que existam)".
-- deal_tasks acabou de ser criada (migration 103) — agora entra no
-- indicador. Alterar o RETURNS TABLE de uma função exige DROP +
-- CREATE (CREATE OR REPLACE rejeita mudança de tipo de retorno);
-- mesmo nome e mesma assinatura de parâmetro, então não sobra overload
-- morto (aprendido da limpeza de filter_contacts nesta mesma fase).
--
-- "Atrasada" = due_at no passado E completed_at ainda null — tarefa
-- sem due_at nunca conta como atrasada.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_pipeline_deal_indicators(uuid);

CREATE FUNCTION public.get_pipeline_deal_indicators(p_pipeline_id uuid)
RETURNS TABLE (
  deal_id uuid,
  unread_count integer,
  ticket_status text,
  outside_24h boolean,
  opted_out boolean,
  overdue_tasks_count integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    d.id AS deal_id,
    COALESCE(conv.unread_count, 0)::integer AS unread_count,
    ot.status AS ticket_status,
    CASE
      WHEN conv.id IS NULL THEN false
      WHEN ch.channel_type = 'evolution' THEN false
      WHEN lm.last_customer_at IS NULL THEN false
      ELSE lm.last_customer_at < now() - interval '24 hours'
    END AS outside_24h,
    (bp.id IS NOT NULL) AS opted_out,
    COALESCE(dt.overdue_count, 0)::integer AS overdue_tasks_count
  FROM deals d
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN LATERAL (
    SELECT cv.id, cv.unread_count, cv.channel_id
    FROM conversations cv
    WHERE cv.contact_id = d.contact_id
    ORDER BY cv.last_message_at DESC NULLS LAST
    LIMIT 1
  ) conv ON true
  LEFT JOIN whatsapp_channels ch ON ch.id = conv.channel_id
  LEFT JOIN LATERAL (
    SELECT t.status
    FROM tickets t
    WHERE t.conversation_id = conv.id AND t.status <> 'closed'
    ORDER BY t.opened_at DESC
    LIMIT 1
  ) ot ON true
  LEFT JOIN LATERAL (
    SELECT max(m.created_at) AS last_customer_at
    FROM messages m
    WHERE m.conversation_id = conv.id AND m.sender_type = 'customer'
  ) lm ON true
  LEFT JOIN blocked_phones bp
    ON bp.account_id = d.account_id
    AND bp.phone_normalized = c.phone_normalized
    AND bp.unblocked_at IS NULL
  LEFT JOIN LATERAL (
    SELECT count(*) AS overdue_count
    FROM deal_tasks dtk
    WHERE dtk.deal_id = d.id
      AND dtk.completed_at IS NULL
      AND dtk.due_at IS NOT NULL
      AND dtk.due_at < now()
  ) dt ON true
  WHERE d.pipeline_id = p_pipeline_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_deal_indicators(uuid) TO authenticated, service_role;
