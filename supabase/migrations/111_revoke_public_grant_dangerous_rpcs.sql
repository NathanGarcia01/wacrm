-- ============================================================
-- 111_revoke_public_grant_dangerous_rpcs.sql
--
-- Follow-up to 110: that migration revoked EXECUTE from anon and
-- authenticated on 5 unauthenticated SECURITY DEFINER functions, but
-- 4 of them (get_daily_report, get_weekly_report, _bcast_bump,
-- recompute_broadcast_counts) were still callable by anon right
-- after — confirmed with has_function_privilege('anon', ...) —
-- because they also carried Postgres's default EXECUTE-to-PUBLIC
-- grant (applied automatically at CREATE FUNCTION time unless
-- explicitly revoked). PUBLIC is the implicit "every role" grant;
-- revoking from two named roles does nothing while PUBLIC still
-- holds it, since every role inherits PUBLIC's privileges.
--
-- get_daily_report/get_weekly_report are legitimately called by an
-- external scheduled job using the service_role key (confirmed in
-- edge_logs, 2026-10-16 01:30 UTC) — the explicit GRANT TO
-- service_role below keeps that working. _bcast_bump is only ever
-- called internally from broadcast_recipient_aggregate_trigger()
-- (also SECURITY DEFINER, runs as the owning role regardless of this
-- revoke) and recompute_broadcast_counts has no known caller in this
-- codebase; service_role is granted on both for parity/future use.
-- postgres keeps access regardless as the owning role.
-- ============================================================

revoke execute on function public.get_daily_report(date) from public;
revoke execute on function public.get_weekly_report(date) from public;
revoke execute on function public._bcast_bump(uuid, text, integer) from public;
revoke execute on function public.recompute_broadcast_counts(uuid) from public;

grant execute on function public.get_daily_report(date) to service_role;
grant execute on function public.get_weekly_report(date) to service_role;
grant execute on function public._bcast_bump(uuid, text, integer) to service_role;
grant execute on function public.recompute_broadcast_counts(uuid) to service_role;
