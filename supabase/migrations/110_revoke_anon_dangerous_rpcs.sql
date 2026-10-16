-- ============================================================
-- 110_revoke_anon_dangerous_rpcs.sql
--
-- Security sweep triggered by the password_reset_tokens /
-- whatsapp_embedded_signup_sessions RLS incident (migration 109) —
-- checked every SECURITY DEFINER function callable via PostgREST RPC
-- for missing/weak authorization. Found four with none at all,
-- exposed to BOTH anon (unauthenticated) and authenticated:
--
-- get_daily_report / get_weekly_report: no account_id parameter —
-- hardcoded to `accounts WHERE is_internal = true`, i.e. the
-- business's OWN account. No auth check. Anyone on the internet could
-- call POST /rest/v1/rpc/get_daily_report with just the public anon
-- key and read the business's actual revenue, deals won/lost,
-- commissions, and broadcast ad spend.
--
-- merge_duplicate_contacts: no parameters, no auth check, globally
-- scans ALL accounts' contacts and merges/deletes duplicates
-- (re-pointing conversations, deals, tags, etc. across every tenant
-- in one call). Meant to be an internal maintenance routine, not
-- something any anonymous caller can trigger at will.
--
-- _bcast_bump(bid, col, delta): no auth check, dynamic `UPDATE
-- broadcasts SET <col> = <col> + delta WHERE id = bid` via format(%I)
-- — col is identifier-quoted (no SQL injection), but ANY numeric
-- column on ANY account's broadcast row (sent_count, meta_total_cost,
-- rate_limit_hits, ...) could be corrupted by an anonymous caller who
-- knows or guesses a broadcast id. Only ever meant to be called from
-- broadcast_recipient_aggregate_trigger().
--
-- recompute_broadcast_counts(bid): no auth check either, but lower
-- severity — it only recomputes real aggregates from
-- broadcast_recipients, the caller can't inject arbitrary values.
-- Revoked anyway for consistency.
--
-- NOTE — this migration alone turned out NOT to be sufficient for 4
-- of the 5 functions: they were also granted EXECUTE to PUBLIC
-- (Postgres's implicit "every role" grant, applied automatically on
-- function creation unless revoked). Revoking FROM anon, authenticated
-- specifically is a no-op against a standing PUBLIC grant, since every
-- role implicitly inherits it. Verified via has_function_privilege()
-- immediately after applying — anon could still execute all 4. See
-- migration 111 for the actual fix (REVOKE ... FROM PUBLIC + explicit
-- GRANT TO service_role).
--
-- Every other anon-callable SECURITY DEFINER function was checked and
-- found to already verify the caller (is_account_member(p_account_id)
-- or auth.uid() IS NOT NULL) before touching any data — those are
-- fine and untouched by this migration.
-- ============================================================

revoke execute on function public.get_daily_report(date) from anon, authenticated;
revoke execute on function public.get_weekly_report(date) from anon, authenticated;
revoke execute on function public.merge_duplicate_contacts() from anon, authenticated;
revoke execute on function public._bcast_bump(uuid, text, integer) from anon, authenticated;
revoke execute on function public.recompute_broadcast_counts(uuid) from anon, authenticated;
