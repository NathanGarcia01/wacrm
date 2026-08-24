-- ============================================================
-- 065_daily_weekly_report_roi_by_broadcast_recipient.sql
--
-- get_daily_report / get_weekly_report computed "ganhos_disparo"
-- (the won-deal figures fed into the broadcast ROI calc) by joining
-- deals to contact_tags on a global 'DISPARO' tag. That tag is
-- applied once, account-wide, whenever a contact ever receives any
-- broadcast — it does not tie a deal back to a SPECIFIC broadcast,
-- so a won deal from a contact who received a broadcast weeks ago
-- (and was won long after, unrelated to any particular send) still
-- counted, while contacts tagged through some other path could be
-- missed entirely. Same class of bug fixed in
-- src/lib/reports/broadcast-roi-queries.ts,
-- src/lib/reports/broadcasts-queries.ts and
-- src/lib/broadcasts/roi-detail.ts: attribution now goes straight
-- through broadcast_recipients (status = actually received) joined
-- to broadcasts, requiring the deal to have won on/after that
-- broadcast's created_at — matching what the Reports UI now does.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_daily_report(report_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  result jsonb;
  v_account_id uuid;
  v_disparos_total integer;
  v_cliques jsonb;
  v_ganhos_qty integer;
  v_ganhos_valor numeric;
  v_ganhos_comissao numeric;
  v_ganhos_disparo_qty integer;
  v_ganhos_disparo_valor numeric;
  v_ganhos_disparo_comissao numeric;
  v_perdidos_qty integer;
  v_perdidos_motivos jsonb;
  v_produtos_top jsonb;
  v_pipeline jsonb;
  v_ticket_medio numeric;
  v_ganhos_mes integer;
  v_perdidos_mes integer;
  v_taxa_conversao numeric;
  v_comissao_mes numeric;
  v_custo_dia numeric;
BEGIN
  SELECT id INTO v_account_id FROM public.accounts WHERE is_internal = true LIMIT 1;

  -- Disparos
  SELECT COUNT(*) INTO v_disparos_total
  FROM public.broadcast_recipients br
  JOIN public.broadcasts b ON b.id = br.broadcast_id
  WHERE DATE(br.sent_at AT TIME ZONE 'America/Sao_Paulo') = report_date
  AND b.account_id = v_account_id
  AND br.status IN ('sent', 'delivered', 'read', 'replied');

  SELECT jsonb_agg(jsonb_build_object('botao', button_clicked, 'total', cnt))
  INTO v_cliques
  FROM (
    SELECT br.button_clicked, COUNT(*) as cnt
    FROM public.broadcast_recipients br
    JOIN public.broadcasts b ON b.id = br.broadcast_id
    WHERE DATE(br.sent_at AT TIME ZONE 'America/Sao_Paulo') = report_date
    AND b.account_id = v_account_id AND br.button_clicked IS NOT NULL
    GROUP BY br.button_clicked ORDER BY cnt DESC
  ) x;

  -- Ganhos totais do dia
  SELECT COUNT(*), COALESCE(SUM(value), 0)
  INTO v_ganhos_qty, v_ganhos_valor
  FROM public.deals
  WHERE DATE(won_at AT TIME ZONE 'America/Sao_Paulo') = report_date
  AND status = 'won' AND account_id = v_account_id;

  SELECT COALESCE(SUM(dp.commission_value), 0) INTO v_ganhos_comissao
  FROM public.deal_products dp
  JOIN public.deals d ON d.id = dp.deal_id
  WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') = report_date
  AND d.status = 'won' AND d.account_id = v_account_id;

  -- Ganhos atribuídos a disparo: deal ganho por contato que recebeu
  -- (status sent/delivered/read/replied) um disparo cuja data de
  -- criação é anterior ou igual ao fechamento do deal — vínculo
  -- direto por contact_id do broadcast_recipients, não por tag.
  SELECT COUNT(DISTINCT d.id), COALESCE(SUM(d.value), 0)
  INTO v_ganhos_disparo_qty, v_ganhos_disparo_valor
  FROM public.deals d
  WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') = report_date
  AND d.status = 'won' AND d.account_id = v_account_id
  AND EXISTS (
    SELECT 1
    FROM public.broadcast_recipients br
    JOIN public.broadcasts b ON b.id = br.broadcast_id
    WHERE br.contact_id = d.contact_id
      AND b.account_id = v_account_id
      AND br.status IN ('sent', 'delivered', 'read', 'replied')
      AND b.created_at <= d.won_at
  );

  SELECT COALESCE(SUM(dp.commission_value), 0) INTO v_ganhos_disparo_comissao
  FROM public.deal_products dp
  JOIN public.deals d ON d.id = dp.deal_id
  WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') = report_date
  AND d.status = 'won' AND d.account_id = v_account_id
  AND EXISTS (
    SELECT 1
    FROM public.broadcast_recipients br
    JOIN public.broadcasts b ON b.id = br.broadcast_id
    WHERE br.contact_id = d.contact_id
      AND b.account_id = v_account_id
      AND br.status IN ('sent', 'delivered', 'read', 'replied')
      AND b.created_at <= d.won_at
  );

  -- Perdidos
  SELECT COUNT(*) INTO v_perdidos_qty
  FROM public.deals
  WHERE DATE(lost_at AT TIME ZONE 'America/Sao_Paulo') = report_date
  AND status = 'lost' AND account_id = v_account_id;

  SELECT jsonb_agg(jsonb_build_object('motivo', COALESCE(lost_reason,'Sem motivo'), 'total', cnt))
  INTO v_perdidos_motivos
  FROM (
    SELECT lost_reason, COUNT(*) as cnt
    FROM public.deals
    WHERE DATE(lost_at AT TIME ZONE 'America/Sao_Paulo') = report_date
    AND status = 'lost' AND account_id = v_account_id
    GROUP BY lost_reason ORDER BY cnt DESC
  ) x;

  -- Produtos top
  SELECT jsonb_agg(jsonb_build_object('produto', name, 'quantidade', qty, 'valor', val, 'comissao', com))
  INTO v_produtos_top
  FROM (
    SELECT dp.name, COUNT(*) as qty, SUM(dp.value * dp.quantity) as val, SUM(dp.commission_value) as com
    FROM public.deal_products dp
    JOIN public.deals d ON d.id = dp.deal_id
    WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') = report_date
    AND d.status = 'won' AND d.account_id = v_account_id
    GROUP BY dp.name ORDER BY qty DESC LIMIT 5
  ) x;

  -- Pipeline com comissão
  SELECT jsonb_agg(jsonb_build_object(
    'etapa', etapa, 'quantidade', qty, 'valor', val, 'comissao_prevista', com
  ) ORDER BY pos)
  INTO v_pipeline
  FROM (
    SELECT
      ps.name as etapa, ps.position as pos,
      COUNT(DISTINCT d.id) as qty,
      COALESCE(SUM(d.value), 0) as val,
      COALESCE(SUM(dp.commission_value), 0) as com
    FROM public.deals d
    JOIN public.pipeline_stages ps ON ps.id = d.stage_id
    LEFT JOIN public.deal_products dp ON dp.deal_id = d.id
    WHERE d.status = 'open' AND d.account_id = v_account_id
    GROUP BY ps.id, ps.name, ps.position
  ) x;

  -- Métricas do mês
  SELECT
    COALESCE(AVG(CASE WHEN status = 'won' THEN value END), 0),
    COUNT(CASE WHEN status = 'won' THEN 1 END),
    COUNT(CASE WHEN status = 'lost' THEN 1 END)
  INTO v_ticket_medio, v_ganhos_mes, v_perdidos_mes
  FROM public.deals
  WHERE account_id = v_account_id
  AND (
    (status = 'won' AND won_at >= date_trunc('month', report_date::timestamptz))
    OR (status = 'lost' AND lost_at >= date_trunc('month', report_date::timestamptz))
  );

  IF (v_ganhos_mes + v_perdidos_mes) > 0 THEN
    v_taxa_conversao := ROUND(v_ganhos_mes::numeric / (v_ganhos_mes + v_perdidos_mes) * 100, 1);
  ELSE
    v_taxa_conversao := 0;
  END IF;

  SELECT COALESCE(SUM(dp.commission_value), 0) INTO v_comissao_mes
  FROM public.deal_products dp
  JOIN public.deals d ON d.id = dp.deal_id
  WHERE d.account_id = v_account_id AND d.status = 'won'
  AND d.won_at >= date_trunc('month', report_date::timestamptz);

  -- Custo do dia
  SELECT COALESCE(SUM(meta_total_cost), 0) INTO v_custo_dia
  FROM public.broadcasts
  WHERE account_id = v_account_id
  AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = report_date;

  result := jsonb_build_object(
    'data', report_date,
    'disparos', jsonb_build_object(
      'total_enviado', v_disparos_total,
      'cliques_por_botao', v_cliques
    ),
    'ganhos', jsonb_build_object(
      'quantidade', v_ganhos_qty,
      'valor_total', v_ganhos_valor,
      'comissao_total', v_ganhos_comissao
    ),
    'ganhos_disparo', jsonb_build_object(
      'quantidade', v_ganhos_disparo_qty,
      'valor_total', v_ganhos_disparo_valor,
      'comissao_total', v_ganhos_disparo_comissao,
      'custo_dia', v_custo_dia,
      'roi_percentual', CASE
        WHEN v_custo_dia > 0
        THEN ROUND(((v_ganhos_disparo_comissao - v_custo_dia) / v_custo_dia * 100)::numeric, 1)
        ELSE 0
      END,
      'multiplo', CASE
        WHEN v_custo_dia > 0
        THEN ROUND((v_ganhos_disparo_comissao / v_custo_dia)::numeric, 1)
        ELSE 0
      END
    ),
    'perdidos', jsonb_build_object(
      'quantidade', v_perdidos_qty,
      'por_motivo', v_perdidos_motivos
    ),
    'produtos_top', v_produtos_top,
    'pipeline', v_pipeline,
    'metricas_mes', jsonb_build_object(
      'ticket_medio', v_ticket_medio,
      'ganhos_mes', v_ganhos_mes,
      'perdidos_mes', v_perdidos_mes,
      'taxa_conversao', v_taxa_conversao,
      'comissao_mes', v_comissao_mes
    ),
    'custo_dia', v_custo_dia
  );

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_weekly_report(week_end_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  result jsonb;
  v_account_id uuid;
  v_week_start date;
  v_disparos_total integer;
  v_cliques jsonb;
  v_ganhos_qty integer;
  v_ganhos_valor numeric;
  v_ganhos_comissao numeric;
  v_ganhos_disparo_qty integer;
  v_ganhos_disparo_comissao numeric;
  v_perdidos_qty integer;
  v_perdidos_motivos jsonb;
  v_produtos_top jsonb;
  v_pipeline jsonb;
  v_ticket_medio numeric;
  v_taxa_conversao numeric;
  v_comissao_semana numeric;
  v_custo_semana numeric;
BEGIN
  SELECT id INTO v_account_id FROM public.accounts WHERE is_internal = true LIMIT 1;
  v_week_start := week_end_date - INTERVAL '6 days';

  -- Disparos da semana
  SELECT COUNT(*) INTO v_disparos_total
  FROM public.broadcast_recipients br
  JOIN public.broadcasts b ON b.id = br.broadcast_id
  WHERE DATE(br.sent_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
  AND b.account_id = v_account_id
  AND br.status IN ('sent', 'delivered', 'read', 'replied');

  SELECT jsonb_agg(jsonb_build_object('botao', button_clicked, 'total', cnt))
  INTO v_cliques
  FROM (
    SELECT br.button_clicked, COUNT(*) as cnt
    FROM public.broadcast_recipients br
    JOIN public.broadcasts b ON b.id = br.broadcast_id
    WHERE DATE(br.sent_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
    AND b.account_id = v_account_id AND br.button_clicked IS NOT NULL
    GROUP BY br.button_clicked ORDER BY cnt DESC
  ) x;

  -- Ganhos da semana
  SELECT COUNT(*), COALESCE(SUM(value), 0)
  INTO v_ganhos_qty, v_ganhos_valor
  FROM public.deals
  WHERE DATE(won_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
  AND status = 'won' AND account_id = v_account_id;

  SELECT COALESCE(SUM(dp.commission_value), 0) INTO v_ganhos_comissao
  FROM public.deal_products dp
  JOIN public.deals d ON d.id = dp.deal_id
  WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
  AND d.status = 'won' AND d.account_id = v_account_id;

  -- Ganhos atribuídos a disparo: vínculo direto por contact_id do
  -- broadcast_recipients (status recebido) cujo broadcast saiu antes
  -- ou no dia do fechamento do deal — não por tag.
  SELECT COUNT(DISTINCT d.id), COALESCE(SUM(dp.commission_value), 0)
  INTO v_ganhos_disparo_qty, v_ganhos_disparo_comissao
  FROM public.deals d
  LEFT JOIN public.deal_products dp ON dp.deal_id = d.id
  WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
  AND d.status = 'won' AND d.account_id = v_account_id
  AND EXISTS (
    SELECT 1
    FROM public.broadcast_recipients br
    JOIN public.broadcasts b ON b.id = br.broadcast_id
    WHERE br.contact_id = d.contact_id
      AND b.account_id = v_account_id
      AND br.status IN ('sent', 'delivered', 'read', 'replied')
      AND b.created_at <= d.won_at
  );

  -- Perdidos da semana
  SELECT COUNT(*) INTO v_perdidos_qty
  FROM public.deals
  WHERE DATE(lost_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
  AND status = 'lost' AND account_id = v_account_id;

  SELECT jsonb_agg(jsonb_build_object('motivo', COALESCE(lost_reason,'Sem motivo'), 'total', cnt))
  INTO v_perdidos_motivos
  FROM (
    SELECT lost_reason, COUNT(*) as cnt
    FROM public.deals
    WHERE DATE(lost_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
    AND status = 'lost' AND account_id = v_account_id
    GROUP BY lost_reason ORDER BY cnt DESC
  ) x;

  -- Produtos top da semana
  SELECT jsonb_agg(jsonb_build_object('produto', name, 'quantidade', qty, 'valor', val, 'comissao', com))
  INTO v_produtos_top
  FROM (
    SELECT dp.name, COUNT(*) as qty, SUM(dp.value * dp.quantity) as val, SUM(dp.commission_value) as com
    FROM public.deal_products dp
    JOIN public.deals d ON d.id = dp.deal_id
    WHERE DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date
    AND d.status = 'won' AND d.account_id = v_account_id
    GROUP BY dp.name ORDER BY qty DESC LIMIT 5
  ) x;

  -- Pipeline atual
  SELECT jsonb_agg(jsonb_build_object(
    'etapa', etapa, 'quantidade', qty, 'valor', val, 'comissao_prevista', com
  ) ORDER BY pos)
  INTO v_pipeline
  FROM (
    SELECT ps.name as etapa, ps.position as pos,
      COUNT(DISTINCT d.id) as qty,
      COALESCE(SUM(d.value), 0) as val,
      COALESCE(SUM(dp.commission_value), 0) as com
    FROM public.deals d
    JOIN public.pipeline_stages ps ON ps.id = d.stage_id
    LEFT JOIN public.deal_products dp ON dp.deal_id = d.id
    WHERE d.status = 'open' AND d.account_id = v_account_id
    GROUP BY ps.id, ps.name, ps.position
  ) x;

  -- Ticket médio e taxa de conversão da semana
  SELECT
    COALESCE(AVG(CASE WHEN status = 'won' THEN value END), 0),
    CASE WHEN COUNT(CASE WHEN status IN ('won','lost') THEN 1 END) > 0
      THEN ROUND(COUNT(CASE WHEN status = 'won' THEN 1 END)::numeric /
           COUNT(CASE WHEN status IN ('won','lost') THEN 1 END) * 100, 1)
      ELSE 0 END
  INTO v_ticket_medio, v_taxa_conversao
  FROM public.deals
  WHERE account_id = v_account_id
  AND (
    (status = 'won' AND DATE(won_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date)
    OR (status = 'lost' AND DATE(lost_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date)
  );

  -- Comissão total da semana
  SELECT COALESCE(SUM(dp.commission_value), 0) INTO v_comissao_semana
  FROM public.deal_products dp
  JOIN public.deals d ON d.id = dp.deal_id
  WHERE d.account_id = v_account_id AND d.status = 'won'
  AND DATE(d.won_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date;

  -- Custo da semana
  SELECT COALESCE(SUM(meta_total_cost), 0) INTO v_custo_semana
  FROM public.broadcasts
  WHERE account_id = v_account_id
  AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN v_week_start AND week_end_date;

  result := jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_week_start, 'fim', week_end_date),
    'disparos', jsonb_build_object('total_enviado', v_disparos_total, 'cliques_por_botao', v_cliques),
    'ganhos', jsonb_build_object('quantidade', v_ganhos_qty, 'valor_total', v_ganhos_valor, 'comissao_total', v_ganhos_comissao),
    'ganhos_disparo', jsonb_build_object(
      'quantidade', v_ganhos_disparo_qty,
      'comissao_total', v_ganhos_disparo_comissao,
      'custo_semana', v_custo_semana,
      'roi_percentual', CASE WHEN v_custo_semana > 0
        THEN ROUND(((v_ganhos_disparo_comissao - v_custo_semana) / v_custo_semana * 100)::numeric, 1)
        ELSE 0 END,
      'multiplo', CASE WHEN v_custo_semana > 0
        THEN ROUND((v_ganhos_disparo_comissao / v_custo_semana)::numeric, 1)
        ELSE 0 END
    ),
    'perdidos', jsonb_build_object('quantidade', v_perdidos_qty, 'por_motivo', v_perdidos_motivos),
    'produtos_top', v_produtos_top,
    'pipeline', v_pipeline,
    'metricas_semana', jsonb_build_object(
      'ticket_medio', v_ticket_medio,
      'ganhos_semana', v_ganhos_qty,
      'perdidos_semana', v_perdidos_qty,
      'taxa_conversao', v_taxa_conversao,
      'comissao_semana', v_comissao_semana
    ),
    'custo_semana', v_custo_semana
  );

  RETURN result;
END;
$function$;
