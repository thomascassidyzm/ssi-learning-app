-- ============================================================================
-- SECURITY FIX #12 (KEYSTONE, Step S1) — flip ALL public views to
--                                        security_invoker = ON
-- ============================================================================
-- ⚠ DO NOT BLIND-APPLY. Run via the canary harness in README_RUNBOOK.md
--   (BEGIN; apply; SET ROLE <each consumer role>; verify expected rows; COMMIT
--   only if every role check passes). The doc's keystone is explicitly
--   "flip + re-test each role returns only its rows."
--
-- WHY: all 21 views run security_invoker=OFF -> as owner `postgres` -> they
-- BYPASS RLS on base tables. This is the #1 prerequisite: until it flips, turning
-- on base-table RLS (Phase B) buys dashboards nothing, because any authenticated
-- user still reads every tenant through the views. It also makes view grants
-- durable — secfix_05 had to also flip the 8 sensitive views because a bare
-- REVOKE regressed when school_summary was later CREATE-OR-REPLACE'd.
--
-- TODAY'S RISK (verified 2026-06-09): low, because most base tables are still
-- RLS-OFF (so authenticated/service consumers read them fine post-flip) and the
-- sensitive anon reads are already cut by secfix_05. The payoff lands as Phase B
-- base-table RLS arrives — then these views auto-enforce tenancy. CANARY-CRITICAL
-- consumers to test before COMMIT:
--   * invite_code_validation / entitlement_code_validation — SECURITY-DEFINER by
--     design, read by the SIGNUP path api/code/validate.ts via SERVICE role.
--     Post-flip they run as the caller; service-role bypasses RLS so signup must
--     still validate a known-good code. TEST THIS.
--   * class_student_progress / class_activity_stats / demographic_cycle_averages
--     / region_summary / school_summary / group_summary — the /schools dashboards
--     (authenticated). TEST a teacher/school-admin/govt-admin load still populates.
--   * course_stats / seed_with_legos / course_* — guest (anon) course discovery
--     + player content load. TEST a logged-out app load still lists courses.

ALTER VIEW public.class_activity_stats              SET (security_invoker = on);
ALTER VIEW public.class_student_progress            SET (security_invoker = on);
ALTER VIEW public.course_audio_inventory            SET (security_invoker = on);
ALTER VIEW public.course_phrases_unified            SET (security_invoker = on);
ALTER VIEW public.course_practice_phrases_with_type SET (security_invoker = on);
ALTER VIEW public.course_progress                   SET (security_invoker = on);
ALTER VIEW public.course_stats                      SET (security_invoker = on);
ALTER VIEW public.course_voice_breakdown            SET (security_invoker = on);
ALTER VIEW public.demographic_cycle_averages        SET (security_invoker = on);
ALTER VIEW public.entitlement_code_validation       SET (security_invoker = on);
ALTER VIEW public.feedback_aggregated               SET (security_invoker = on);
ALTER VIEW public.group_summary                     SET (security_invoker = on);
ALTER VIEW public.invite_code_validation            SET (security_invoker = on);
ALTER VIEW public.learner_consistency               SET (security_invoker = on);
ALTER VIEW public.learner_stats                     SET (security_invoker = on);
ALTER VIEW public.learner_subscription_status       SET (security_invoker = on);
ALTER VIEW public.region_summary                    SET (security_invoker = on);
ALTER VIEW public.school_summary                    SET (security_invoker = on);
ALTER VIEW public.seed_cycles                       SET (security_invoker = on);
ALTER VIEW public.seed_with_legos                   SET (security_invoker = on);
ALTER VIEW public.weekly_leaderboard                SET (security_invoker = on);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (if any canary fails): re-run with `security_invoker = off` for the
-- offending view(s), or ROLLBACK the whole transaction.
