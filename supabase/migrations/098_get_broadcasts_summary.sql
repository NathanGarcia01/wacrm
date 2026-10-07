-- ============================================================
-- 098_get_broadcasts_summary.sql
--
-- Fase 5 (Transmissões), Etapa 4 — RPC pros cards de resumo no topo
-- de /broadcasts. Estado ATUAL (não depende de período escolhido na
-- UI) + "mensagens enviadas no mês" no fuso da conta — mesma técnica
-- de date_trunc('month', now() at time zone v_tz) já usada em
-- get_pipeline_dashboard()/get_user_summary_dashboard() (migration
-- 087). Tudo calculado no banco via COUNT, nunca baixando a lista de
-- broadcasts/recipients inteira pro cliente.
--
-- blocked_phones_count entra no mesmo RPC (card "Bloqueados
-- (opt-out)" é mostrado ao lado dos outros, mesma tela).
--
-- SECURITY DEFINER com guard manual is_account_member(), STABLE,
-- mesmo padrão de todo RPC de dashboard desta conta desde a Fase 3.
--
-- Testado em transação com rollback (role simulado authenticated)
-- antes de aplicar: retornou paused_count=5, sending_count=0,
-- scheduled_count=0, blocked_phones_count=0, sent_this_month_count=424
-- pra conta 2303e920-... — consistente com o paused_count=5 já
-- confirmado na investigação da Etapa 5/migration 094.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_broadcasts_summary(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_month_start_local timestamp;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_result jsonb;
BEGIN
  IF NOT is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT timezone INTO v_tz FROM accounts WHERE id = p_account_id;
  IF v_tz IS NULL THEN
    v_tz := 'America/Sao_Paulo';
  END IF;

  v_month_start_local := date_trunc('month', now() at time zone v_tz);
  v_month_start := v_month_start_local at time zone v_tz;
  v_month_end := (v_month_start_local + interval '1 month') at time zone v_tz;

  SELECT jsonb_build_object(
    'sending_count', (SELECT count(*) FROM broadcasts WHERE account_id = p_account_id AND status = 'sending'),
    'scheduled_count', (SELECT count(*) FROM broadcasts WHERE account_id = p_account_id AND status = 'scheduled'),
    'paused_count', (SELECT count(*) FROM broadcasts WHERE account_id = p_account_id AND status = 'paused'),
    'sent_this_month_count', (
      SELECT count(*) FROM broadcast_recipients br
      JOIN broadcasts b ON b.id = br.broadcast_id
      WHERE b.account_id = p_account_id
        AND br.sent_at >= v_month_start AND br.sent_at < v_month_end
    ),
    'blocked_phones_count', (SELECT count(*) FROM blocked_phones WHERE account_id = p_account_id AND unblocked_at IS NULL),
    'month', v_month_start_local::date
  ) INTO v_result;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_broadcasts_summary(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_broadcasts_summary(uuid) TO authenticated, service_role;
