-- ============================================================
-- Migration corretiva — realinha o schema de produção com o que as
-- migrations 042-045 deste repositório deveriam ter aplicado.
--
-- Contexto: 042/043 foram aplicadas em produção via Supabase MCP numa
-- sessão anterior, mas com um vocabulário DIFERENTE do que o código
-- deste repo espera ('flow'/'automation' em vez de
-- 'conversational'/'workflow'; 'contact_tag_added' em vez de
-- 'tag_added'; faltando 'conversation_assigned'/'time_based'). 044 e
-- 045 nunca chegaram a ser aplicadas (flow_pending_executions não
-- existe). Adicionalmente, `flow_nodes.node_type` nunca foi ampliado
-- pra nenhum dos ~15 node types novos das Fases D/E1-E4 — gap que não
-- estava coberto por nenhuma migration existente.
--
-- Verificado antes de escrever isto: só 3 linhas em `flows`
-- (run_mode='flow', trigger_type IN ('keyword_match','manual')) e só
-- 2 tipos em `flow_nodes` (`end`, `send_message`) existem hoje em
-- produção — nada usa os valores/tipos que estão sendo removidos do
-- vocabulário abaixo, então os UPDATEs de realinhamento não têm
-- linhas órfãs a se preocupar.
-- ============================================================

-- ---- 1. flows.run_mode: realinha pro vocabulário do código ----
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_run_mode_check;
UPDATE flows SET run_mode = 'conversational' WHERE run_mode = 'flow';
UPDATE flows SET run_mode = 'workflow' WHERE run_mode = 'automation';
ALTER TABLE flows ALTER COLUMN run_mode SET DEFAULT 'conversational';
ALTER TABLE flows ADD CONSTRAINT flows_run_mode_check
  CHECK (run_mode IN ('conversational', 'workflow'));

-- ---- 2. flows.trigger_type: realinha pro vocabulário completo (Fase C) ----
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

-- ---- 3. flow_runs.run_mode: nunca foi criada (Fase A) ----
ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'conversational';
ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_run_mode_check;
ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_run_mode_check
  CHECK (run_mode IN ('conversational', 'workflow'));

-- ---- 4. flow_pending_executions: nunca foi criada (Fase D) ----
CREATE TABLE IF NOT EXISTS flow_pending_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  resume_node_key TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_pending_due
  ON flow_pending_executions(run_at) WHERE status = 'pending';

ALTER TABLE flow_pending_executions ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policy for authenticated users — all
-- access is server-side via the service-role key (mirrors
-- automation_pending_executions).

-- ---- 5. flow_nodes.node_type: nunca foi ampliado pros node types novos ----
-- Gap não coberto por nenhuma migration anterior — as Fases D/E1-E4
-- só tocaram TypeScript/UI, presumindo (incorretamente) que o CHECK
-- do banco já tinha sido tratado em algum lugar. `http_fetch` sai do
-- vocabulário: nunca foi um node_type real no código (só citado em
-- comentário como ideia descartada, substituída por `send_webhook`),
-- e nenhuma linha em produção o usa.
ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'collect_input',
    'wait',
    'condition',
    'randomizer',
    'set_tag',
    'start_flow',
    'stop_flow',
    'create_deal',
    'update_deal_stage',
    'update_deal_value',
    'mark_deal_won',
    'mark_deal_lost',
    'assign_conversation',
    'unassign_agent',
    'update_contact_field',
    'open_conversation',
    'set_conversation_pending',
    'close_conversation',
    'send_webhook',
    'handoff',
    'end'
  ));
