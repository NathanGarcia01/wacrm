-- ============================================================
-- Trial automático no signup + RLS para o app ler sua própria
-- subscription/plano + is_active para desativar contas.
--
-- Contexto: `handle_new_user()` (migration 017) cria a `accounts` row
-- no signup mas nunca criou uma `subscriptions` row — todo signup
-- ficava sem trial algum, sub sempre null. Esta migration:
--   1. Garante `accounts.is_active` (já existe em produção fora de
--      qualquer migration; IF NOT EXISTS deixa o histórico consistente
--      para outros ambientes/forks).
--   2. Adiciona policies de SELECT em `subscriptions` e `plans` — sem
--      elas o client anon/authenticated não enxerga nada nessas
--      tabelas (RLS ligado, zero policies = zero linhas), então o
--      dashboard não tinha como mostrar banner de trial nem plano.
--   3. Reescreve `handle_new_user()` para criar a subscription
--      trialing (7 dias) junto com a account.
--   4. Backfill: contas já existentes sem subscription (e não
--      internas) recebem a mesma janela de trial de 7 dias que um
--      cadastro novo receberia — evita bloquear quem já usava o
--      produto assim que o gating entrar em produção.
-- ============================================================

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT
  USING (is_account_member(account_id));

-- Catálogo de planos não é sensível (preço/nome exibidos em /billing/plans
-- mesmo antes do login) — leitura liberada para qualquer authenticated.
DROP POLICY IF EXISTS plans_select ON public.plans;
CREATE POLICY plans_select ON public.plans FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_starter_plan_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  SELECT id INTO v_starter_plan_id FROM public.plans WHERE code = 'starter' LIMIT 1;

  IF v_starter_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (account_id, plan_id, status, seats, trial_start, trial_end)
    VALUES (v_account_id, v_starter_plan_id, 'trialing', 1, now(), now() + interval '7 days');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile/subscription for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Backfill — mesma regra (7 dias a partir de agora), só para quem
-- ainda não tem nenhuma subscription e não é conta interna (interna já
-- bypassa billing, não precisa de trial).
INSERT INTO public.subscriptions (account_id, plan_id, status, seats, trial_start, trial_end)
SELECT a.id, p.id, 'trialing', 1, now(), now() + interval '7 days'
FROM public.accounts a
LEFT JOIN public.subscriptions s ON s.account_id = a.id
CROSS JOIN LATERAL (SELECT id FROM public.plans WHERE code = 'starter' LIMIT 1) p
WHERE s.id IS NULL AND a.is_internal = false;
