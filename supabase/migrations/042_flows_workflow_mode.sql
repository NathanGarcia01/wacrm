-- ============================================================
-- Fase A da unificação automations → flows: colunas aditivas só,
-- ZERO mudança de comportamento. Nenhum código ainda lê/escreve
-- `run_mode` ou `migrated_to_flow_id` — esta migration só prepara o
-- terreno pras fases seguintes (ver plano em
-- /Users/mac/.claude/plans/piped-strolling-cray.md).
--
-- run_mode ('conversational' | 'workflow'):
--   - conversational = o motor de chatbot de hoje (flows/engine.ts),
--     sem nenhuma mudança. Todo flow/flow_run existente recebe este
--     valor por default.
--   - workflow = novo modo equivalente a automations (evento →
--     execução única, sem esperar resposta do cliente). Construído
--     nas fases seguintes.
--
-- `idx_one_active_run_per_contact` (migration 017) continua como
-- está por enquanto — só passa a ser restrito a run_mode
-- ='conversational' na Fase H, depois que o motor workflow existir
-- de verdade e for testado. Reescrever esse índice agora, sem nada
-- usando run_mode ainda, não traria benefício e adiantaria o risco.
--
-- trigger_type: amplia o CHECK pra aceitar 'keyword' E 'keyword_match'
-- simultaneamente — transição pra Fase B renomear as linhas existentes
-- sem quebrar o constraint no meio do caminho.
--
-- Idempotente — segue a convenção das migrations anteriores.
-- ============================================================

ALTER TABLE flows ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'conversational';
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_run_mode_check;
ALTER TABLE flows ADD CONSTRAINT flows_run_mode_check
  CHECK (run_mode IN ('conversational', 'workflow'));

ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'conversational';
ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_run_mode_check;
ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_run_mode_check
  CHECK (run_mode IN ('conversational', 'workflow'));

ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN ('keyword', 'keyword_match', 'first_inbound_message', 'manual'));

-- Marca automations já migradas pra um flow equivalente, pra
-- runAutomationsForTrigger poder pular sem depender só de is_active
-- (preserva o histórico mesmo que alguém reative por engano).
ALTER TABLE automations ADD COLUMN IF NOT EXISTS migrated_to_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL;
