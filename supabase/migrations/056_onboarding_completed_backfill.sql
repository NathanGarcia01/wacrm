-- ============================================================
-- Migration 055 added `onboarding_completed boolean NOT NULL DEFAULT
-- false` — which, being an ALTER on an existing table, backfilled
-- every pre-existing profile row to `false` too, not just future
-- signups. Left alone, every current user would see the "first login"
-- tour pop up on their next login, which is not the intended
-- behavior — the tour is for genuinely new signups, not a surprise
-- for existing customers who already know the product.
--
-- One-time backfill: mark every profile that existed before this
-- feature shipped as already onboarded. Anything created after 055
-- ran keeps the column's real default (false) and gets the tour.
-- ============================================================

UPDATE public.profiles
SET onboarding_completed = true
WHERE onboarding_completed = false;
