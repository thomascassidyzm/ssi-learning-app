-- ============================================================================
-- SECURITY FIX #8 (HIGH, Phase B / B1) — user_tags self-promote-to-teacher
-- ============================================================================
-- THE HOLE: user_tags has RLS OFF, and the authenticated role still holds an
-- INSERT grant. The own-row INSERT policy ("user_tags_insert") only checks
-- user_id = auth.uid() — it does NOT constrain role_in_context. So any logged-in
-- learner can:
--   INSERT user_tags {user_id:<self>, tag_type:'school', tag_value:'SCHOOL:<id>',
--                     role_in_context:'teacher'}
-- after which the schools_select / classes_select / teacher-data RLS predicates
-- (which key off tag_type + role_in_context) expose that school's student PII
-- (sessions, seed/lego progress, enrolments). Full privilege escalation.
--
-- VERIFIED 2026-06-09: anon has NO grant on user_tags (a_sel/a_ins=false) and
-- Popty never touches it, so nothing logged-out breaks. The legitimate INSERTs
-- of privileged roles all run server-side as SERVICE-role (api/admin/
-- create-staff.ts, api/code/redeem.ts, api/teacher/paddle-webhook.ts) and
-- bypass RLS + this CHECK. The only client writes are own-row UPDATEs
-- (useAuth.ts:237 user_id re-point; TeachersView/ClassDetail removed_at
-- soft-delete) — these need an own-row UPDATE policy added (there is none today,
-- only god-user ALL), or RLS-on would break them.

-- 1. Tighten the INSERT CHECK: self-serve may only insert NON-privileged roles.
--    'teacher'/'admin' must come through the service-role API routes.
DROP POLICY IF EXISTS "user_tags_insert" ON public.user_tags;
CREATE POLICY "user_tags_insert" ON public.user_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (auth.uid())::text
    AND role_in_context IS DISTINCT FROM 'teacher'
    AND role_in_context IS DISTINCT FROM 'admin'
  );

-- 2. Add the missing own-row UPDATE policy so the legitimate client UPDATEs keep
--    working under RLS, while still blocking self-promotion via UPDATE.
DROP POLICY IF EXISTS "user_tags_update" ON public.user_tags;
CREATE POLICY "user_tags_update" ON public.user_tags
  FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text)
  WITH CHECK (
    user_id = (auth.uid())::text
    AND role_in_context IS DISTINCT FROM 'teacher'
    AND role_in_context IS DISTINCT FROM 'admin'
  );

-- 3. Enable RLS so the (now-correct) policies are actually enforced.
--    Kept as-is: god-user SELECT/ALL, own-row SELECT, own-row DELETE.
ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- POST-ENABLE CANARY (run as the affected role, see runbook):
--   * authenticated own-row UPDATE of removed_at  -> must succeed
--   * authenticated INSERT {role_in_context:'teacher', user_id:self} -> must FAIL (42501)
--   * useAuth user_id re-point UPDATE -> must succeed
