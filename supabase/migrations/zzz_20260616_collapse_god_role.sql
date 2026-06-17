-- ============================================================================
-- Collapse the 'god' role into 'ssi_admin' — ONE platform-admin concept.
--
-- Finishes what 20260616_is_ssi_admin_includes_god started. 'god'
-- (educational_role) and 'ssi_admin' (platform_role) were two near-identical
-- admin concepts from two migration lineages; the split caused the silent
-- client-vs-DB asymmetry bugs. This retires 'god' entirely:
--   - platform_role='ssi_admin' (via is_ssi_admin()) = the single admin gate
--   - educational_role goes back to pure school context (NULL = individual learner)
--
-- KEYSTONE (step 2): is_god_user() is redefined as a thin deprecated alias of
-- is_ssi_admin(). Every historical RLS policy / function gate that still calls
-- is_god_user() (~20, including multi-condition `OR is_god_user()` disjuncts)
-- inherits the collapse through ONE function change — no risky per-policy
-- rewrites. The analytics_* RPCs that this repo rewrites elsewhere call
-- is_ssi_admin() directly; everything else rides the alias.
--
-- Ordering inside this file is load-bearing: backfill BEFORE tightening the
-- CHECK constraints.
-- ============================================================================

-- 1) Backfill: every god user becomes a real ssi_admin (most already are; a
--    user who only redeemed SSI-GOD-2026 would have platform_role NULL).
UPDATE learners
SET platform_role = 'ssi_admin'
WHERE educational_role = 'god'
  AND platform_role IS DISTINCT FROM 'ssi_admin';

-- 2) KEYSTONE: is_god_user() -> deprecated alias of is_ssi_admin().
--    Kept (not dropped) as a safety net for any caller missed here or living
--    outside this repo (dashboard / native app). Drop it in a later pass once
--    the surface is provably clean.
CREATE OR REPLACE FUNCTION public.is_god_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT public.is_ssi_admin();   -- DEPRECATED: 'god' collapsed into 'ssi_admin' (2026-06-16)
$$;

-- 3) Repoint any 'god' invite codes (incl. seeded SSI-GOD-2026) to grant ssi_admin.
UPDATE invite_codes SET code_type = 'ssi_admin' WHERE code_type = 'god';

-- 4) Retire the 'god' educational_role value. These users keep
--    platform_role='ssi_admin'; educational_role=NULL means "individual learner",
--    which is correct for a platform admin with no school context.
UPDATE learners SET educational_role = NULL WHERE educational_role = 'god';

-- 5) Tighten CHECK constraints to forbid 'god' (safe now — no rows hold it).
ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_educational_role_check;
ALTER TABLE learners ADD CONSTRAINT learners_educational_role_check
  CHECK (educational_role IN ('student', 'teacher', 'school_admin', 'govt_admin'));

ALTER TABLE invite_codes DROP CONSTRAINT IF EXISTS invite_codes_code_type_check;
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_code_type_check
  CHECK (code_type IN ('ssi_admin', 'govt_admin', 'school_admin', 'school_admin_join', 'teacher', 'student', 'tester'));

-- 6) Simplify is_ssi_admin() back to the clean single-column check. Supersedes
--    20260616_is_ssi_admin_includes_god — its `OR educational_role='god'` arm is
--    now dead code referencing a value the CHECK above forbids.
CREATE OR REPLACE FUNCTION public.is_ssi_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learners
    WHERE user_id = (auth.uid()::text)
    AND platform_role = 'ssi_admin'
  );
$$;

NOTIFY pgrst, 'reload schema';
