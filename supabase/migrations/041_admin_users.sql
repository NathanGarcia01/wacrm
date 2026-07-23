-- ============================================================
-- Multi-admin auth for /admin.
--
-- Replaces the single shared ADMIN_SECRET password with per-person
-- email+password login and role-based access: 'owner' gets full
-- access including destructive billing actions, 'viewer' is
-- read-only (no action buttons, mutating routes reject with 403).
--
-- RLS: enabled with zero policies. This table is only ever touched
-- by the service-role admin client (see src/lib/admin/admin-client.ts),
-- same as every other admin-panel table — but unlike those, this one
-- holds password hashes, so it gets RLS turned on explicitly rather
-- than relying on "nothing queries it from the client" as the only
-- guard. With RLS on and no policies, anon/authenticated get zero
-- access via PostgREST; only the service role (which bypasses RLS
-- entirely) can read/write it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'viewer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Login looks up by whatever email the person types — enforce
-- case-insensitive uniqueness so "Nathan@x.com" and "nathan@x.com"
-- can't exist as two separate rows.
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_lower_idx ON public.admin_users (lower(email));

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
