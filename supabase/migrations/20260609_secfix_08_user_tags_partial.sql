-- ============================================================================
-- SECURITY FIX #8 (HIGH, Phase B / B1) — user_tags: SAFE-TODAY PARTIAL
-- ============================================================================
-- THE HOLE (full): user_tags RLS OFF + authenticated holds INSERT & UPDATE
-- grants + the own-row INSERT policy doesn't constrain role_in_context = any
-- logged-in learner can self-grant a 'teacher'/'admin' tag and unlock a school's
-- student PII (full privilege escalation).
--
-- WHY THE FULL RLS-ENABLE IS BLOCKED (verified 2026-06-09):
--   Enabling RLS with an own-row UPDATE policy USING(user_id = auth.uid()::text)
--   would BREAK the post-login auth-link cascade in
--   packages/player-vue/src/composables/useAuth.ts:226-237 —
--     supabase.from('user_tags').update({user_id:NEW}).eq('user_id', OLD)
--   It runs as the AUTHENTICATED client and re-points rows from a prior id (OLD)
--   to the new auth id (NEW). The USING predicate is evaluated against the OLD
--   row (user_id = OLD ≠ auth.uid() = NEW) -> blocked. No service-role/definer
--   bypass exists. This is precisely the "silent-empty on RLS-enable" pattern
--   that forced the original RLS disable. Full enable is therefore gated on the
--   identity bridge (see 20260609_PHASE_B_BLOCKED_user_tags_class_sessions.md):
--   move the re-point + the removed_at soft-deletes to a SECURITY DEFINER fn or
--   a service-role API route, THEN enable RLS with the tightened policies.
--
-- WHAT IS SAFE TODAY: revoke the UNUSED authenticated INSERT grant. Verified:
--   no client code INSERTs user_tags (all privileged inserts go through the
--   service-role API routes api/admin/create-staff.ts, api/code/redeem.ts,
--   api/teacher/paddle-webhook.ts, which bypass grants). The legit client writes
--   are UPDATEs (re-point + soft-delete), untouched here. anon already has no grant.
-- This closes the self-promote-VIA-INSERT vector at the grant layer (RLS off ->
-- 42501 on the forged INSERT) without enabling RLS, so nothing breaks.

REVOKE INSERT ON public.user_tags FROM authenticated;
REVOKE INSERT ON public.user_tags FROM anon;  -- already none; idempotent belt-and-braces

NOTIFY pgrst, 'reload schema';

-- RESIDUAL (NOT closed by this partial, needs the identity-bridge full enable):
--   a learner who already OWNS a user_tags row could UPDATE its role_in_context
--   to 'teacher' (authenticated UPDATE grant still present, RLS off). Narrower
--   than the INSERT vector (requires a pre-existing owned row) but real. Tracked
--   in the PHASE_B_BLOCKED note; do not consider user_tags fully closed.
