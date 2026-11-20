-- ============================================================
-- 138_followup_skip_dedup.sql
--
-- Fase 2 (Follow-up seguro) — B2, correção de um bug real: os skips
-- com motivo max_attempts_reached/daily_cap_reached/
-- outside_business_hours são decididos dentro de triggerMatches
-- (engine.ts/workflow-engine.ts) ANTES de executeAutomation/
-- executeWorkflowNode rodar — ou seja, NUNCA escrevem em
-- automation_logs/flow_runs, que é o que o dedup por período de
-- silêncio (automation_logs/flow_runs count desde last_message_at)
-- depende pra parar de reavaliar a mesma automation/flow. Resultado:
-- enquanto a conversa continuar bloqueada por um desses 3 motivos, TODA
-- varredura do cron (a cada poucos minutos) grava uma linha nova em
-- followup_dispatch_log pra essa conversa — 100 varreduras na mesma
-- janela de silêncio geram 100 linhas, não 1.
--
-- Fix: coluna `silence_started_at` guarda a âncora do período de
-- silêncio atual (= conversations.last_message_at no momento da
-- varredura, o mesmo valor repassado pro cron em todo tick enquanto
-- nenhum lado manda mensagem nova) só nas linhas de skip desses 3
-- motivos — as demais (outcome='sent', ou skip por opted_out/
-- customer_replied/outside_session_window, que já têm dedup próprio)
-- continuam com essa coluna null.
--
-- Índice único em (conversation_id, reason, silence_started_at) dá a
-- garantia de verdade: NULL é distinto de NULL em índice único padrão
-- do Postgres, então linhas com silence_started_at null (todo o resto)
-- nunca colidem entre si — só as 3 linhas-alvo, que sempre preenchem
-- esse valor, ficam de fato restritas a 1 por (conversa, motivo,
-- período). O código (inactivity-followup.ts,
-- logFollowupSkipOncePerSilencePeriod) grava com upsert +
-- ignoreDuplicates, então o 2º+ insert do mesmo período vira
-- ON CONFLICT DO NOTHING — sem race mesmo se dois ticks sobrepuserem.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

alter table public.followup_dispatch_log
  add column if not exists silence_started_at timestamptz;

create unique index if not exists followup_dispatch_log_skip_dedup_uq
  on public.followup_dispatch_log (conversation_id, reason, silence_started_at);
