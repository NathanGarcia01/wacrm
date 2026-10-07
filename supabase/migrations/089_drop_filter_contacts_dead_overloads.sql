-- ============================================================
-- 089_drop_filter_contacts_dead_overloads.sql — removes the 3 dead
-- filter_contacts() overloads left behind by migrations 026, 035,
-- and 068.
--
-- Each of those migrations' comment claimed "CREATE OR REPLACE
-- FUNCTION replaces the function in place (same identity)" — that's
-- only true when the parameter list doesn't change. Every one of
-- them appended new parameters, which changes the function's
-- identity in Postgres, so CREATE OR REPLACE created a NEW overload
-- each time instead of replacing the old one. By the time migration
-- 088 ran, 3 old overloads (8/14/16 params) were still live
-- alongside the current 16-param one (now 18, after 088) — dead
-- code, but still directly callable via raw SQL (not through
-- PostgREST, which always resolves to the newest one because the
-- frontend passes the full current named-parameter set).
--
-- Confirmed via repo-wide grep before writing this migration: the
-- only caller of filter_contacts() in the whole codebase is
-- src/app/(dashboard)/contacts/page.tsx, and it already calls with
-- the complete current parameter set (unique to the 18-param
-- overload) — dropping the other 3 signatures changes nothing for
-- any caller.
--
-- Signatures being dropped (exact arg lists, from migrations 026/
-- 035/068 respectively):
--   8-arg:  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT
--   14-arg: ...above... + TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
--   16-arg: ...above... + TEXT, TEXT
-- The current 18-arg overload (migration 088) is untouched.
--
-- Regression-tested in a rolled-back transaction before applying:
-- after dropping the 3 overloads, exactly 1 remains, and it still
-- returns correct results both with no filters (full total_count)
-- and with filters (p_origin/p_deal_status) active.
--
-- Idempotent — DROP FUNCTION IF EXISTS, safe to run multiple times.
-- ============================================================

DROP FUNCTION IF EXISTS public.filter_contacts(
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT
);

DROP FUNCTION IF EXISTS public.filter_contacts(
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
);

DROP FUNCTION IF EXISTS public.filter_contacts(
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);
