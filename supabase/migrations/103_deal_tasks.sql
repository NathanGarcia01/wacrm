-- ============================================================
-- 103_deal_tasks.sql
--
-- Fase 6 (negócio com conversa embutida) — aba Tarefas do painel.
-- Não existia nenhum precedente de "tarefa" genérica no schema (grep
-- amplo por task/reminder/follow_up, nada relacionado) — tabela nova.
--
-- Mesmo formato de deal_products (migration recente, child direto de
-- deals): account_id E deal_id lado a lado (não só via join), sem
-- updated_at. RLS espelha deals (migration 017) — select pra
-- qualquer account member, mutação exige 'agent' — tarefa é uma ação
-- operacional sobre o negócio, mesmo nível de quem move estágio ou
-- cria o deal.
--
-- assigned_to referencia profiles(id) (a PK do profile, não
-- profiles.user_id) — mesma convenção de deals.assigned_to, já
-- corrigido uma vez nesta mesma fase (deal_events, migration 101).
--
-- is_done é computado (completed_at IS NOT NULL) em vez de uma coluna
-- própria — evita os dois ficarem incoerentes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deal_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_tasks_deal ON public.deal_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_tasks_account ON public.deal_tasks(account_id);
-- Usado pelo indicador "tarefas atrasadas" no card do pipeline
-- (get_pipeline_deal_indicators, próxima migration) — só tarefas
-- abertas com due_at no passado importam pra esse filtro.
CREATE INDEX IF NOT EXISTS idx_deal_tasks_overdue
  ON public.deal_tasks(deal_id, due_at)
  WHERE completed_at IS NULL;

ALTER TABLE public.deal_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY deal_tasks_select ON public.deal_tasks
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY deal_tasks_insert ON public.deal_tasks
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY deal_tasks_update ON public.deal_tasks
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY deal_tasks_delete ON public.deal_tasks
  FOR DELETE USING (is_account_member(account_id, 'agent'));
