-- Caixa de entrada — regra de status, ajuste pedido após ver a Parte 1
-- ao vivo: uma mensagem de bot/fluxo só conta como "respondido" (verde)
-- enquanto o FLUXO que a mandou ainda está em jogo (status 'active' ou
-- 'waiting_reply' para o contato). Se o fluxo já terminou
-- (completed/cancelled/failed/timed_out) e ninguém humano respondeu
-- depois, a bola está com a GENTE, não com o cliente — vermelho
-- "Esperando atendente", não verde.
--
-- Denormalizado em conversations.bot_awaiting_human (mesma razão de
-- last_message_sender_type/last_customer_message_at — migration 120:
-- a lista não carrega flow_runs por linha). Dois triggers, porque o
-- evento que torna isso verdadeiro pode ser tanto "mandamos uma
-- mensagem de bot" quanto "o fluxo que já tinha mandado a última
-- mensagem acabou de terminar" — a ordem relativa entre o insert da
-- mensagem final e o endRun() que fecha o fluxo não é garantida.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_awaiting_human boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION sync_conversation_last_message_meta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations
  SET last_message_sender_type = NEW.sender_type,
      last_customer_message_at = CASE
        WHEN NEW.sender_type = 'customer' THEN NEW.created_at
        ELSE last_customer_message_at
      END,
      bot_awaiting_human = CASE
        WHEN NEW.sender_type = 'bot' THEN NOT EXISTS (
          SELECT 1 FROM flow_runs fr
          WHERE fr.contact_id = conversations.contact_id
            AND fr.status IN ('active', 'waiting_reply')
        )
        ELSE false
      END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_conversation_awaiting_human_on_run_end()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled', 'failed', 'timed_out')
     AND OLD.status IN ('active', 'waiting_reply')
     AND NEW.contact_id IS NOT NULL
  THEN
    UPDATE conversations c
    SET bot_awaiting_human = true
    WHERE c.contact_id = NEW.contact_id
      AND c.account_id = NEW.account_id
      AND c.last_message_sender_type = 'bot'
      AND NOT EXISTS (
        SELECT 1 FROM flow_runs fr2
        WHERE fr2.contact_id = NEW.contact_id
          AND fr2.status IN ('active', 'waiting_reply')
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flow_runs_sync_conversation_awaiting_human ON flow_runs;
CREATE TRIGGER flow_runs_sync_conversation_awaiting_human
  AFTER UPDATE ON flow_runs
  FOR EACH ROW EXECUTE FUNCTION sync_conversation_awaiting_human_on_run_end();

-- Backfill — mesmo critério do trigger 1, aplicado a tudo que já
-- tem last_message_sender_type = 'bot' hoje.
UPDATE conversations c
SET bot_awaiting_human = true
WHERE c.last_message_sender_type = 'bot'
  AND NOT EXISTS (
    SELECT 1 FROM flow_runs fr
    WHERE fr.contact_id = c.contact_id
      AND fr.status IN ('active', 'waiting_reply')
  );
