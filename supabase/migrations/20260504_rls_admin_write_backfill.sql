-- ============================================================================
-- RLS: Admin write-access backfill for phases 1-4
-- ============================================================================
-- Phases 1-4 added SELECT policies (own-row + admin) but no admin
-- INSERT/UPDATE/DELETE policies. In practice all admin writes go through
-- service-role APIs (which bypass RLS entirely), but if a frontend page ever
-- tries to mutate one of these tables while authenticated as Tom (rather than
-- via a service-role API), it would currently fail.
--
-- This migration adds belt-and-suspenders admin write policies to all 7
-- already-RLS'd tables so admins are never blocked from any path. Service
-- role behaviour unchanged. Anon and non-admin authenticated users still
-- can't write (no policies for them = denied).
--
-- Depends on the is_ssi_admin() helper added in Phase 1.
--
-- Rollback: at bottom.
-- ============================================================================

-- 1. teachers — already has INSERT (own) and UPDATE (own + admin); add DELETE
CREATE POLICY "teachers_delete_admin"
  ON public.teachers FOR DELETE
  USING (public.is_ssi_admin());

-- 2. teacher_referrals — currently SELECT-only; add admin write set
CREATE POLICY "teacher_referrals_insert_admin"
  ON public.teacher_referrals FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "teacher_referrals_update_admin"
  ON public.teacher_referrals FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "teacher_referrals_delete_admin"
  ON public.teacher_referrals FOR DELETE
  USING (public.is_ssi_admin());

-- 3. teacher_commissions — currently SELECT-only; add admin write set
CREATE POLICY "teacher_commissions_insert_admin"
  ON public.teacher_commissions FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "teacher_commissions_update_admin"
  ON public.teacher_commissions FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "teacher_commissions_delete_admin"
  ON public.teacher_commissions FOR DELETE
  USING (public.is_ssi_admin());

-- 4. subscriptions — already has user INSERT (own); add admin UPDATE + DELETE
CREATE POLICY "subscriptions_update_admin"
  ON public.subscriptions FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "subscriptions_delete_admin"
  ON public.subscriptions FOR DELETE
  USING (public.is_ssi_admin());

-- 5. entitlement_codes — currently SELECT-only; add admin write set
CREATE POLICY "entitlement_codes_insert_admin"
  ON public.entitlement_codes FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "entitlement_codes_update_admin"
  ON public.entitlement_codes FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "entitlement_codes_delete_admin"
  ON public.entitlement_codes FOR DELETE
  USING (public.is_ssi_admin());

-- 6. user_entitlements — currently SELECT-only; add admin write set
CREATE POLICY "user_entitlements_insert_admin"
  ON public.user_entitlements FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "user_entitlements_update_admin"
  ON public.user_entitlements FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "user_entitlements_delete_admin"
  ON public.user_entitlements FOR DELETE
  USING (public.is_ssi_admin());

-- 7. audio_plays — currently SELECT-only; add admin write set
CREATE POLICY "audio_plays_insert_admin"
  ON public.audio_plays FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "audio_plays_update_admin"
  ON public.audio_plays FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "audio_plays_delete_admin"
  ON public.audio_plays FOR DELETE
  USING (public.is_ssi_admin());

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- DROP POLICY IF EXISTS "teachers_delete_admin" ON public.teachers;
-- DROP POLICY IF EXISTS "teacher_referrals_insert_admin" ON public.teacher_referrals;
-- DROP POLICY IF EXISTS "teacher_referrals_update_admin" ON public.teacher_referrals;
-- DROP POLICY IF EXISTS "teacher_referrals_delete_admin" ON public.teacher_referrals;
-- DROP POLICY IF EXISTS "teacher_commissions_insert_admin" ON public.teacher_commissions;
-- DROP POLICY IF EXISTS "teacher_commissions_update_admin" ON public.teacher_commissions;
-- DROP POLICY IF EXISTS "teacher_commissions_delete_admin" ON public.teacher_commissions;
-- DROP POLICY IF EXISTS "subscriptions_update_admin" ON public.subscriptions;
-- DROP POLICY IF EXISTS "subscriptions_delete_admin" ON public.subscriptions;
-- DROP POLICY IF EXISTS "entitlement_codes_insert_admin" ON public.entitlement_codes;
-- DROP POLICY IF EXISTS "entitlement_codes_update_admin" ON public.entitlement_codes;
-- DROP POLICY IF EXISTS "entitlement_codes_delete_admin" ON public.entitlement_codes;
-- DROP POLICY IF EXISTS "user_entitlements_insert_admin" ON public.user_entitlements;
-- DROP POLICY IF EXISTS "user_entitlements_update_admin" ON public.user_entitlements;
-- DROP POLICY IF EXISTS "user_entitlements_delete_admin" ON public.user_entitlements;
-- DROP POLICY IF EXISTS "audio_plays_insert_admin" ON public.audio_plays;
-- DROP POLICY IF EXISTS "audio_plays_update_admin" ON public.audio_plays;
-- DROP POLICY IF EXISTS "audio_plays_delete_admin" ON public.audio_plays;
-- NOTIFY pgrst, 'reload schema';
