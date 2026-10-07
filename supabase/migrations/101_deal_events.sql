-- ============================================================
-- 101_deal_events.sql
--
-- Fase 6 (negócio com conversa embutida), Etapa 1 — histórico de
-- eventos do negócio ("Registros"), criado AGORA e gravando desde já
-- (decisão explícita: sem UI ainda, sem backfill — não existe log
-- histórico pra reconstruir).
--
-- Trigger AFTER INSERT OR UPDATE em deals, SECURITY DEFINER (pra
-- sempre poder escrever em deal_events independente de quem fez o
-- UPDATE em deals — agente via RLS, ou automations/cron via service
-- role). actor_id = auth.uid() no momento da chamada; auth.uid() lê o
-- JWT da REQUISIÇÃO (não é afetado por SECURITY DEFINER, que só troca
-- o papel de privilégio SQL) — fica NULL quando a escrita vem de
-- automations/flows/cron (service role, sem JWT de usuário), que é o
-- comportamento certo: null = sistema, não um agente.
--
-- Eventos cobertos (exatamente os pedidos):
--   created          — ao inserir o negócio.
--   stage_changed    — from_stage_id/to_stage_id, dispara em QUALQUER
--                       caminho que mude stage_id (board drag-drop,
--                       Sheet, barra de etapas do painel novo,
--                       automations update_deal_stage) — não precisa
--                       instrumentar cada call site separadamente.
--   won / lost       — lost carrega lost_reason/lost_reason_id.
--   assignee_changed — from_assigned_to/to_assigned_to.
--   value_changed    — from_value/to_value.
--
-- RLS: só SELECT (is_account_member) — toda escrita passa pelo
-- trigger SECURITY DEFINER; não existe policy de INSERT pra
-- authenticated, então um cliente não pode forjar um evento direto.
--
-- Testado em transação com rollback: insert + stage change + value
-- change + assignee change + status=lost geraram exatamente os 5
-- eventos esperados, com actor_id correto (auth.uid() simulado) e
-- lost_reason capturado.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'stage_changed', 'won', 'lost', 'assignee_changed', 'value_changed')),
  actor_id uuid,
  from_stage_id uuid,
  to_stage_id uuid,
  from_assigned_to uuid,
  to_assigned_to uuid,
  from_value numeric,
  to_value numeric,
  lost_reason text,
  lost_reason_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_events_deal ON public.deal_events(deal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_events_account ON public.deal_events(account_id);

ALTER TABLE public.deal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_events_select ON public.deal_events;
CREATE POLICY deal_events_select ON public.deal_events
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.log_deal_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_events (deal_id, account_id, event_type, actor_id, to_stage_id, to_assigned_to, to_value)
    VALUES (NEW.id, NEW.account_id, 'created', v_actor, NEW.stage_id, NEW.assigned_to, NEW.value);
    RETURN NEW;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_events (deal_id, account_id, event_type, actor_id, from_stage_id, to_stage_id)
    VALUES (NEW.id, NEW.account_id, 'stage_changed', v_actor, OLD.stage_id, NEW.stage_id);
  END IF;

  IF NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' THEN
    INSERT INTO deal_events (deal_id, account_id, event_type, actor_id)
    VALUES (NEW.id, NEW.account_id, 'won', v_actor);
  END IF;

  IF NEW.status = 'lost' AND OLD.status IS DISTINCT FROM 'lost' THEN
    INSERT INTO deal_events (deal_id, account_id, event_type, actor_id, lost_reason, lost_reason_id)
    VALUES (NEW.id, NEW.account_id, 'lost', v_actor, NEW.lost_reason, NEW.lost_reason_id);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO deal_events (deal_id, account_id, event_type, actor_id, from_assigned_to, to_assigned_to)
    VALUES (NEW.id, NEW.account_id, 'assignee_changed', v_actor, OLD.assigned_to, NEW.assigned_to);
  END IF;

  IF NEW.value IS DISTINCT FROM OLD.value THEN
    INSERT INTO deal_events (deal_id, account_id, event_type, actor_id, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, 'value_changed', v_actor, OLD.value, NEW.value);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_log_events ON public.deals;
CREATE TRIGGER deals_log_events
  AFTER INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_event();
