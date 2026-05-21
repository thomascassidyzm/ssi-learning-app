-- ============================================
-- Fix learners UPDATE GRANT — replace ineffective column REVOKE
-- with proper table REVOKE + column GRANT pattern
-- ============================================
-- Date: 2026-05-21
--
-- Problem
-- -------
-- 20260521180000_block_anon_role_escalation.sql tried to block
-- updates to learners.platform_role / educational_role with:
--
--   REVOKE UPDATE (platform_role, educational_role) ON learners
--     FROM anon, authenticated;
--
-- But Supabase grants anon + authenticated TABLE-LEVEL UPDATE on
-- public tables by default. PostgreSQL column-level REVOKE does
-- NOT mask an existing table-level grant — it only removes any
-- column-specific grant (which didn't exist here, so the REVOKE
-- was effectively a no-op).
--
-- Verification 2026-05-21:
--   PATCH /rest/v1/learners?user_id=eq.nonexistent
--   Body: {"platform_role":"ssi_admin"}
--   anon-key only — returned HTTP 204 (success, 0 rows matched).
--
-- That means the role-escalation exploit is still open via UPDATE
-- on existing learners (the INSERT shape is correctly blocked, so
-- attackers can't create a new ssi_admin, but they CAN elevate any
-- existing learner row by picking a user_id from the still-anon-
-- readable learners table).
--
-- Fix
-- ---
-- 1. REVOKE UPDATE at table level from anon + authenticated.
-- 2. GRANT UPDATE on only the columns legitimate client flows
--    need (verified by grep of all client write paths under
--    packages/player-vue/src + packages/core/src).
-- 3. anon gets no UPDATE grant at all — anon should never modify
--    learner rows; that path is always via signed-in JWT.
--
-- Legit UPDATE columns (sources)
-- ------------------------------
-- * preferences            — App.vue:258, ProgressStore.ts:68
-- * verified_emails        — useAuth.ts:206 (multi-email cascade)
-- * user_id                — useAuth.ts:229 (guest→authed migration)
-- * display_name           — SettingsScreen.vue:195
-- * updated_at             — ProgressStore.ts:70
--
-- Expected breakage (intentional — needs follow-up)
-- -------------------------------------------------
-- packages/player-vue/src/composables/admin/useAdminUserDetail.ts
-- lines 316-343 (updateUserRole) does:
--
--   client.from('learners').update({ [field]: value })
--     .eq('id', learnerId)
--
-- ...where `field` is 'platform_role' | 'educational_role'. This
-- IS the admin UI for role changes — same shape as the exploit,
-- defended-against here. After this migration, that admin flow
-- returns "permission denied" and needs to move to a server-side
-- /api/admin/update-user-role route that uses service-role +
-- admin auth check. Same pattern as the SchoolsSetup.vue retrofit
-- already on the follow-up list.
--
-- Notes
-- -----
-- RLS is still off on learners; this migration is purely at the
-- GRANT layer. Row-level scoping (only update own row) remains a
-- separate concern for a future RLS pass.

BEGIN;

-- ============================================
-- 1. Remove the table-level UPDATE grant entirely
-- ============================================

REVOKE UPDATE ON learners FROM anon;
REVOKE UPDATE ON learners FROM authenticated;

-- ============================================
-- 2. Re-grant UPDATE only on the safe columns
-- ============================================
-- anon: no grant. anon should not UPDATE learners at all.
-- authenticated: grant only the columns the legit client flows touch.

GRANT UPDATE (preferences, verified_emails, user_id, display_name, updated_at)
  ON learners TO authenticated;

-- Note: the column-level REVOKE from 20260521180000 is now redundant
-- (the table-level UPDATE is gone). Leaving it in place — it's a
-- no-op once the table grant is revoked, and removing the REVOKE
-- statement from the prior migration would rewrite history.

NOTIFY pgrst, 'reload schema';

COMMIT;
