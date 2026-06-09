-- ============================================================================
-- SECURITY FIX #9 (HIGH, Phase B / B1) — class_sessions: SAFE-TODAY PARTIAL
-- ============================================================================
-- THE HOLE (full): class_sessions RLS OFF; anon holds SELECT/INSERT/UPDATE/DELETE
-- (152 rows readable/forgeable/wipeable via the public key); and even once RLS is
-- on, the existing "Authenticated can read class_sessions" policy is USING(true)
-- = cross-tenant read for any logged-in user.
--
-- WHY THE FULL RLS-ENABLE IS BLOCKED (verified 2026-06-09):
--   The class-play writers
--     LearningPlayer.vue:640-671 and useClassesData.ts:521-557
--   write teacher_user_id = learnerId = learner.value.id (the learners PK), as
--   the AUTHENTICATED client. But the existing write policy
--     "Teachers can write own class_sessions"
--        WITH CHECK (teacher_user_id = auth.uid()::text)
--   compares against auth.uid() (= learners.user_id, a DIFFERENT column). So the
--   stored value (learner.id) never equals auth.uid() -> enabling RLS makes every
--   class-session INSERT/UPDATE fail WITH CHECK and BREAKS class-play (incl. the
--   Dublin demo if it runs class mode). The fix is an identity-mapped predicate:
--     teacher_user_id IN (SELECT id::text FROM learners WHERE user_id = auth.uid()::text)
--   plus the same correction on the SELECT predicate. That MUST be staged with a
--   live canary (real teacher JWT) before enabling. See the PHASE_B_BLOCKED note.
--
-- WHAT IS SAFE TODAY: revoke ALL anon grants. Verified: no anon/logged-out/guest
-- path and no Popty path reads or writes class_sessions — every reader/writer is
-- the AUTHENTICATED teacher inside the OTP-gated /schools dashboard. So removing
-- anon access closes the public-key read/forge/wipe of 152 rows and breaks nothing.
-- (The authenticated cross-tenant SELECT(true) leak remains until the full enable.)

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.class_sessions FROM anon;

NOTIFY pgrst, 'reload schema';

-- RESIDUAL (NOT closed by this partial): an AUTHENTICATED (logged-in) user can
-- still read all class_sessions cross-tenant via the open SELECT(true) policy
-- once RLS is on, and today (RLS off) via the authenticated SELECT grant. Closing
-- it requires the identity-mapped RLS enable in the PHASE_B_BLOCKED note.
