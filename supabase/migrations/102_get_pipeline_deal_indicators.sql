-- ============================================================
-- 102_get_pipeline_deal_indicators.sql
--
-- Fase 6 (negócio com conversa embutida) — indicadores no card do
-- pipeline (decisão 4): não lidas, status de ticket aberto
-- (pending/in_progress), fora da janela de 24h, opt-out. Tarefas
-- atrasadas fica de fora por ora — deal_tasks ainda não existe.
--
-- Uma RPC batched por pipeline em vez de N+1: hoje o board já carrega
-- todos os deals de um pipeline numa chamada só (loadDeals,
-- pipelines/page.tsx); esta função devolve os indicadores de todos
-- eles numa segunda chamada só, nunca por card.
--
-- SECURITY INVOKER (sem SECURITY DEFINER, sem guard manual) — mesmo
-- padrão de filter_contacts (migration 100): confia inteiramente na
-- RLS já existente de deals/contacts/conversations/tickets/messages/
-- blocked_phones (todas já lidas diretamente do client em outros
-- lugares do código, como contact-sidebar.tsx e OptOutBanner).
--
-- Conversa do contato: no máximo uma por contato (confirmado no
-- diagnóstico da Fase 6 — findOrCreateConversation busca só por
-- contact_id) — mesmo assim um LATERAL com ORDER BY + LIMIT 1 por
-- segurança, igual ao que deal-conversation-tab.tsx já faz no client.
--
-- "Fora da 24h": canal evolution nunca entra na janela (mesma regra
-- de computeSessionWindow, src/lib/whatsapp/session-window.ts); sem
-- mensagem do cliente ainda = não mostra o indicador (não é "fora",
-- é "nunca houve janela").
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pipeline_deal_indicators(p_pipeline_id uuid)
RETURNS TABLE (
  deal_id uuid,
  unread_count integer,
  ticket_status text,
  outside_24h boolean,
  opted_out boolean
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
    (bp.id IS NOT NULL) AS opted_out
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
  WHERE d.pipeline_id = p_pipeline_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_deal_indicators(uuid) TO authenticated, service_role;
