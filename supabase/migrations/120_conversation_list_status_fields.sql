-- Caixa de entrada redesign (proposta A+C), Parte 1 — the list's status
-- line (red "esperando", amber "janela fecha em Xh", green "respondido",
-- gray "fora da janela") needs, per row, (a) who sent the last message
-- and (b) when the customer last wrote, WITHOUT loading each
-- conversation's full message history into the list query. Denormalized
-- onto `conversations`, kept in sync by a trigger on `messages` so every
-- insert path (webhook, broadcasts, flows, automations, NPS, manual
-- send) stays correct without each one having to remember to update it.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_sender_type text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz;

CREATE OR REPLACE FUNCTION sync_conversation_last_message_meta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations
  SET last_message_sender_type = NEW.sender_type,
      last_customer_message_at = CASE
        WHEN NEW.sender_type = 'customer' THEN NEW.created_at
        ELSE last_customer_message_at
      END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_sync_conversation_last_meta ON messages;
CREATE TRIGGER messages_sync_conversation_last_meta
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION sync_conversation_last_message_meta();

-- One-time backfill so existing conversations have correct values from
-- the moment this ships, not just from the next new message onward.
WITH last_msg AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, sender_type
  FROM messages
  ORDER BY conversation_id, created_at DESC
),
last_customer AS (
  SELECT conversation_id, max(created_at) AS last_customer_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
)
UPDATE conversations c
SET last_message_sender_type = lm.sender_type,
    last_customer_message_at = lc.last_customer_at
FROM last_msg lm
LEFT JOIN last_customer lc ON lc.conversation_id = lm.conversation_id
WHERE c.id = lm.conversation_id;
