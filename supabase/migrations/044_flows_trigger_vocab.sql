-- ============================================================
-- Fase C da unificação automations → flows: amplia flows.trigger_type
-- pro vocabulário inteiro de automations. Nenhum código lê/dispara
-- esses valores novos ainda — a Fase E/F/G que constrói o motor
-- workflow e liga os pontos de disparo. Até lá isso é só espaço
-- reservado no CHECK constraint, zero risco.
--
-- 'keyword_match' e 'first_inbound_message' já eram aceitos (usados
-- pelo motor conversacional hoje). Os demais só passam a fazer
-- sentido pra flows com run_mode='workflow' (Fase F em diante) —
-- 'manual' continua exclusivo do modo conversacional (botão "Acionar
-- fluxo" no inbox).
--
-- Idempotente.
-- ============================================================

ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN (
    'keyword_match',
    'first_inbound_message',
    'manual',
    'new_message_received',
    'first_outbound_message',
    'new_contact_created',
    'conversation_assigned',
    'tag_added',
    'time_based',
    'conversation_opened',
    'conversation_closed',
    'deal_stage_changed',
    'deal_won',
    'deal_lost',
    'button_clicked',
    'nps_received',
    'inactivity'
  ));
