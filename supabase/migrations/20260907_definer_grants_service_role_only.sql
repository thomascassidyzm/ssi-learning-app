-- Four SECURITY DEFINER functions that only a server ever calls were executable
-- by `anon` and `authenticated`. Take the grant away.
--
-- Found while fixing find_learner_by_email (the same day, same shape). These
-- are not RLS holes: SECURITY DEFINER runs as postgres, so the grant IS the
-- authorisation, and a blanket `GRANT ... TO anon, authenticated, service_role`
-- is the whole gate being open. Each of the four was verified live to have no
-- caller outside a service-role server route, across the whole estate:
--
--   accrue_teacher_commission_held  WRITES a teacher's commission ledger row.
--   reverse_teacher_commission      WRITES the reversal of one.
--     Both are called only by api/teacher/paddle-webhook.ts, which holds the
--     service-role key. Until now an unauthenticated caller holding nothing but
--     the public anon key could accrue or reverse money against any teacher.
--
--   audit_log_prune                 DELETES rows from the content audit log.
--     Maintenance-only, run by a server. An anon caller could erase the audit
--     trail — including the trail of their own tampering.
--
--   analytics_learner_progress_rate READS one learner's progress rate by id.
--     No caller anywhere in the estate. It is the find_learner_by_email shape
--     one step further out: a client-supplied learner id, no ownership gate at
--     all, and reachable WITHOUT signing in.
--
-- WATCH THE `PUBLIC` GRANT. audit_log_prune also carried EXECUTE for PUBLIC
-- (`=X/postgres` in proacl), and PUBLIC covers anon and authenticated too — so
-- revoking those two by name changed nothing until PUBLIC went as well. That is
-- worth knowing before writing any other REVOKE against a DEFINER function:
-- check proacl for a bare `=X/` entry, or the revoke is decorative.
--
-- service_role keeps EXECUTE, so every real caller is untouched. If something
-- does go dark, the repair is one GRANT — say so rather than guessing.

REVOKE EXECUTE ON FUNCTION public.accrue_teacher_commission_held(uuid, date, date, integer, timestamp with time zone) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_teacher_commission(uuid, date, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_log_prune(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_learner_progress_rate(uuid, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accrue_teacher_commission_held(uuid, date, date, integer, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_teacher_commission(uuid, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_log_prune(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_learner_progress_rate(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── second pass, after the #324 sibling audit ────────────────────────────────
-- Two more ungated WRITES that `anon` could reach. Both switch which version of
-- an AI course-generation prompt or brief is live, from a client-supplied
-- key — an unauthenticated caller could repoint content generation at any
-- stored version. Neither has a caller anywhere in the estate (searched both
-- repos and the surface), and both carried the PUBLIC grant as well as the two
-- browser roles, so PUBLIC has to go or the revoke does nothing.
REVOKE EXECUTE ON FUNCTION public.activate_brief_version(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_prompt_version(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_brief_version(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_prompt_version(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
