-- ============================================================================
-- SECURITY FIX #5 (HIGH) — close the anon-readable learner/school/payment VIEWS
-- ============================================================================
-- THE LEAK: 8 aggregate VIEWS over learner progress, school activity, and
-- PAYMENT status are SELECTable by the anon role (the public key shipped in
-- every browser bundle). Because all 21 public views run security_invoker=OFF
-- (as owner `postgres`), they BYPASS RLS on their base tables — so anon reads
-- every learner's data through the view even though the base tables already
-- have anon revoked.
--
-- The sharpest is `learner_subscription_status` — it exposes who-pays for all
-- 1398 learners. `school_summary` REGRESSED: 20260226_rls_entitlements_fix.sql
-- revoked anon on it, but a later CREATE OR REPLACE VIEW reset its grants, so
-- it is anon-readable AGAIN live (2026-06-09). This is exactly why we also flip
-- security_invoker=ON here: it survives view recreation, where a bare REVOKE
-- does not.
--
-- VERIFIED 2026-06-09 (cross-repo consumer scan, both repos):
--   learner_subscription_status — read ONLY by service-role API routes
--       (api/subscription/index.ts, api/me/subscription.ts). Never anon.
--   learner_stats / learner_consistency / course_progress — ZERO consumers.
--   weekly_leaderboard — referenced only in an uninvoked RPC; base tables deny anon.
--   school_summary / group_summary — read ONLY by the OTP-gated /schools
--       dashboard (useSchoolData.ts) as the AUTHENTICATED role.
--   feedback_aggregated — read ONLY by Popty SERVICE-role API routes.
-- None are read on any anon/logged-out path. Base tables are all RLS-off but
-- already anon-revoked, so security_invoker=ON does not empty them for the
-- authenticated/service consumers (which can read the base tables).
--
-- SAFE: anon loses these views; authenticated + service keep working.

-- 1. Make the views respect the caller's privileges (durable; survives recreate).
ALTER VIEW public.learner_subscription_status SET (security_invoker = on);
ALTER VIEW public.learner_stats              SET (security_invoker = on);
ALTER VIEW public.learner_consistency        SET (security_invoker = on);
ALTER VIEW public.course_progress            SET (security_invoker = on);
ALTER VIEW public.weekly_leaderboard         SET (security_invoker = on);
ALTER VIEW public.school_summary             SET (security_invoker = on);
ALTER VIEW public.group_summary              SET (security_invoker = on);
ALTER VIEW public.feedback_aggregated        SET (security_invoker = on);

-- 2. Revoke the anon grant (defense in depth alongside the invoker flip).
REVOKE ALL ON public.learner_subscription_status FROM anon;
REVOKE ALL ON public.learner_stats              FROM anon;
REVOKE ALL ON public.learner_consistency        FROM anon;
REVOKE ALL ON public.course_progress            FROM anon;
REVOKE ALL ON public.weekly_leaderboard         FROM anon;
REVOKE ALL ON public.school_summary             FROM anon;
REVOKE ALL ON public.group_summary              FROM anon;
REVOKE ALL ON public.feedback_aggregated        FROM anon;

-- 3. Keep the legitimate authenticated readers (schools dashboards).
GRANT SELECT ON public.school_summary TO authenticated;
GRANT SELECT ON public.group_summary  TO authenticated;

-- 4. Reload PostgREST so the change takes effect immediately.
NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- DEFERRED (NOT in this migration), documented for the record:
--   course_stats   — KEEP anon: read logged-out by CourseSelector.vue /
--                    BrowseScreen.vue for guest course discovery (Dublin demo).
--   seed_with_legos, seed_cycles, course_audio_inventory,
--   course_phrases_unified, course_practice_phrases_with_type,
--   course_voice_breakdown — content views; the underlying content tables are
--   anon-readable BY DESIGN (offline PWA), so the views leak nothing extra.
--   They are handled in secfix_12 (security_invoker sweep) for hygiene.
-- ----------------------------------------------------------------------------
