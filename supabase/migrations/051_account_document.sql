-- ============================================================
-- CPF/CNPJ obrigatório no cadastro — evita múltiplas contas com o
-- mesmo documento.
--
-- `document` is nullable at the column level (existing accounts have
-- none, and there's no real CPF/CNPJ to backfill for them) — "required"
-- is enforced at the app layer (signup form + API validation route),
-- not a NOT NULL constraint. The partial unique index below is the
-- actual enforcement point against duplicates, and skips NULLs so
-- legacy accounts don't collide with each other.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS document_type text CHECK (document_type IN ('cpf', 'cnpj'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_document
  ON public.accounts(document) WHERE document IS NOT NULL;

-- handle_new_user() (migrations 017, 050) now also persists the
-- document/document_type the client sent in signUp()'s raw_user_meta_data
-- — checksum + uniqueness are validated ahead of time by
-- POST /api/auth/validate-document, called before signUp() ever runs.
-- That pre-check closes the normal path, but it can't close a race
-- between two concurrent signups for the same document — the unique
-- index is what actually decides that. Unlike the rest of this
-- function's failures (logged as a warning, swallowed, signup still
-- "succeeds" with a profile that can be repaired later), a
-- unique_violation here must fail the whole transaction: silently
-- swallowing it would leave a real auth.users row with no account/
-- profile/subscription at all, and the user would believe signup
-- worked. Re-raising rolls back the auth.users insert too, so
-- signUp() itself errors out and the client can show a clear message.
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
  v_document TEXT;
  v_document_type TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_document := NULLIF(NEW.raw_user_meta_data->>'document', '');
  v_document_type := NULLIF(NEW.raw_user_meta_data->>'document_type', '');

  INSERT INTO public.accounts (name, owner_user_id, document, document_type)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, v_document, v_document_type)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  SELECT id INTO v_starter_plan_id FROM public.plans WHERE code = 'starter' LIMIT 1;

  IF v_starter_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (account_id, plan_id, status, seats, trial_start, trial_end)
    VALUES (v_account_id, v_starter_plan_id, 'trialing', 1, now(), now() + interval '7 days');
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_document' USING ERRCODE = 'unique_violation';
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to bootstrap account/profile/subscription for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
