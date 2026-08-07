-- School-admin PARITY: route every hand-inlined admin_user_id test through
-- is_school_admin_of(), so a tag admin reads exactly what a pointer admin reads.
--
-- Companion to 20260807c, which taught is_school_admin_of() to recognise the
-- school ADMIN TAG as well as the schools.admin_user_id pointer. That alone
-- unblocked the Classes tab, because classes_select was the one policy that
-- actually CALLED the helper. Every other place that asks "is this caller an
-- admin of this school?" had the test hand-inlined as
--
--     EXISTS (SELECT 1 FROM schools s WHERE s.id = <x> AND s.admin_user_id = auth.uid()::text)
--
-- and those copies do NOT get fixed by fixing the function. Verified live
-- 2026-08-07 as "Harbour Leader" (a tag admin at Harbour View School) with
-- 20260807c applied: she read all 3 classes but 0 roster rows and 0 sessions,
-- while the pointer admin (Ashwin) read 3 / 40 / 66. So the Classes tab would
-- have listed her three classes each claiming "0 students" and a flat activity
-- sparkline — the same silent-empty lie, one table further down.
--
-- THE TARGET IS PARITY, NOT WIDENING. A school's tag admin should see and do
-- precisely what that school's pointer admin sees and does — no more. Every
-- edit below is the SAME edit: delete a duplicated inline predicate, call the
-- canonical helper instead. Net effect on the pointer admin: nil (the helper's
-- first disjunct IS that pointer test). Net effect on everyone else: nil.
--
-- Not touched, deliberately:
--   * schools_insert — its CHECK (admin_user_id = auth.uid()::text) is not a
--     membership test at all; it means "the school you create must name YOU".
--     Replacing it would be a category error.
--   * schools_select — already reads (admin_user_id = auth.uid() OR
--     has_user_tag('school', ...)), so tag holders were never locked out. This
--     is why the leader could see her school's NAME while seeing none of its
--     classes.
--   * schools_update — still pointer-only, so a tag admin may not be able to
--     edit school settings from the browser. Left alone on purpose: it is a
--     WRITE widening that Tom's request does not need, and I have not verified
--     whether that surface writes client-side or through a server endpoint.
--     Flagged as a known remaining gap rather than changed blind.
--
-- Canaried per RLS doctrine rule 3:
-- supabase/secfix-toolkit/canary_school_admin_tag_recognised.cjs

-- 1. class_sessions_read — the per-class activity sparkline and session history.
DROP POLICY IF EXISTS class_sessions_read ON public.class_sessions;
CREATE POLICY class_sessions_read ON public.class_sessions
  FOR SELECT USING (
    teacher_user_id = (SELECT auth.uid())::text
    OR is_god_user()
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_sessions.class_id
        AND (
          c.teacher_user_id = (SELECT auth.uid())::text
          OR is_school_admin_of(c.school_id)
        )
    )
  );

-- 2. user_tags_select — the class roster (class_student_progress is a
--    security_invoker view that JOINs user_tags), student lists, staff lists.
--    Two inlined copies: the SCHOOL: branch and the CLASS: branch. The CLASS:
--    branch's LEFT JOIN to schools goes away entirely — is_school_admin_of()
--    returns false for a NULL school_id, which is exactly what the LEFT JOIN
--    produced for a groupless tutor's class.
DROP POLICY IF EXISTS user_tags_select ON public.user_tags;
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT USING (
    user_id = (SELECT auth.uid())::text
    OR is_god_user()
    OR EXISTS (
      SELECT 1 FROM public.schools s
      WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
        AND is_school_admin_of(s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE user_tags.tag_value = 'CLASS:' || c.id::text
        AND (
          c.teacher_user_id = (SELECT auth.uid())::text
          OR is_school_admin_of(c.school_id)
          OR is_class_teacher(c.id)
        )
    )
  );

-- 3. user_tags_update — the write counterpart of the read above (a leader
--    removing a student from a class soft-deletes that student's class tag
--    from the browser). Without this the read would succeed and the write
--    would silently no-op: the false-"Saved" class this codebase bans (RLS
--    doctrine rule 8). The role_in_context guards are carried over UNCHANGED —
--    a caller who is merely a class teacher still cannot write 'teacher' or
--    'admin' rows, which is the founder ruling of 2026-08-06 (20260806b).
DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE
  USING (
    user_id = (SELECT auth.uid())::text
    OR is_god_user()
    OR EXISTS (
      SELECT 1 FROM public.schools s
      WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
        AND is_school_admin_of(s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE user_tags.tag_value = 'CLASS:' || c.id::text
        AND (
          c.teacher_user_id = (SELECT auth.uid())::text
          OR is_school_admin_of(c.school_id)
          OR (
            is_class_teacher(c.id)
            AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
            AND user_tags.role_in_context IS DISTINCT FROM 'admin'
          )
        )
    )
  )
  WITH CHECK (
    is_god_user()
    OR (
      user_id = (SELECT auth.uid())::text
      AND role_in_context IS DISTINCT FROM 'teacher'
      AND role_in_context IS DISTINCT FROM 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.schools s
      WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
        AND is_school_admin_of(s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE user_tags.tag_value = 'CLASS:' || c.id::text
        AND (
          c.teacher_user_id = (SELECT auth.uid())::text
          OR is_school_admin_of(c.school_id)
          OR (
            is_class_teacher(c.id)
            AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
            AND user_tags.role_in_context IS DISTINCT FROM 'admin'
          )
        )
    )
  );

-- 4. invite_codes teacher-code INSERT — the leader's "Invite a person" button.
--    Also retires a legacy auth.jwt()->>'sub' spelling (CLAUDE.md's canonical
--    pattern is auth.uid()::text, which is what the helper uses).
DROP POLICY IF EXISTS "School admins can create teacher codes" ON public.invite_codes;
CREATE POLICY "School admins can create teacher codes" ON public.invite_codes
  FOR INSERT WITH CHECK (
    code_type = 'teacher'
    AND is_school_admin_of(invite_codes.grants_school_id)
  );

NOTIFY pgrst, 'reload schema';

-- APPLIED LIVE 2026-08-07. Note for the record: this did NOT land by a clean
-- canary --commit. A canary run deadlocked mid-apply while a concurrent
-- session held user_tags, and the DB was afterwards found partially applied,
-- with user_tags_update carrying its USING clause but no WITH CHECK — which
-- briefly let any authenticated user promote their own tag to
-- role_in_context 'admin'. That was detected and closed within minutes, the
-- remaining statements were applied deliberately with a lock_timeout, and the
-- whole end state was then re-read from pg_policy and re-proved live:
--     node supabase/secfix-toolkit/verify_school_admin_tag_parity.cjs
-- (9/9 green: parity, no widening, no self-escalation). Run that, not the
-- canary, to check the current state.
--
-- SIBLING FILE — read both. A second agent worked this same bug in parallel on
-- 2026-08-07 and reached the same diagnosis independently, landing
-- 20260807d_school_admin_tag_read_parity.sql. The two overlap on user_tags
-- select+update (identical predicates) and are otherwise complementary: that
-- file also fixes can_view_learner_data(); this one also fixes
-- class_sessions_read and the invite_codes teacher-code INSERT. Both are
-- idempotent and converge on the same end state in either order. The live
-- state after both is proved by verify_school_admin_tag_parity.cjs.
