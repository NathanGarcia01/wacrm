-- ============================================================
-- Fase D da unificação automations → flows: fila de retomada por
-- tempo, espelhando `automation_pending_executions` (migration 006 +
-- account_id em 017). Diferença: flows é grafo, não árvore, então o
-- ponto de retomada é só um `resume_node_key` (o node_key a re-entrar),
-- em vez de parent_step_id+branch+next_step_position.
--
-- Ninguém escreve nesta tabela ainda — o node_type `wait` entra no
-- vocabulário de flow_nodes nesta mesma fase, mas o executor
-- (src/lib/flows/workflow-engine.ts) só é construído na Fase E. Até
-- lá isso é schema morto de propósito, mesmo espírito da Fase C.
--
-- RLS: sem policy pra authenticated, igual automation_pending_executions
-- — toda escrita é server-side via service-role.
-- ============================================================

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
