-- is_school_admin_of(): recognise the school ADMIN TAG, not only the pointer.
--
-- THE BUG (found live 2026-08-07, Tom testing staging as "Harbour Leader",
-- School Admin at "Harbour View School, Visakhapatnam"):
--
--   The Dashboard tab showed her school's three classes — Grade 6B, Grade 7A,
--   Y7 English — while the Classes tab, for the SAME user in the SAME school,
--   said "0 classes" and rendered the first-run "No classes yet — Create your
--   first class" empty state. Flatly contradictory, and it locked her out of
--   the class detail page, which is the ONLY place a teacher can be attached
--   to a class.
--
-- WHY. The two tabs read through different doors. The dashboard's "below this"
-- list is SERVER-mediated (service role, resolveVisibleScope). The Classes tab
-- reads `classes` DIRECTLY from the browser, so it goes through RLS:
--
--   classes_select := teacher_user_id = auth.uid()::text
--                  OR is_school_admin_of(school_id)
--                  OR has_user_tag('class', 'CLASS:' || id::text)
--
-- and is_school_admin_of() asked exactly ONE question: is this caller the
-- `schools.admin_user_id` pointer? Harbour Leader is not — that pointer is the
-- school's founding admin (Ashwin). She is a school admin by USER TAG
-- (tag_type='school', role_in_context='admin'), which is what the invite path
-- writes for every admin after the first. So all three disjuncts were false,
-- the read came back silently empty, and the UI reported that emptiness as
-- "you have no classes yet".
--
-- This is the classic silent-empty symptom (RLS doctrine rule 2: "permission
-- denied" = grant layer; silent empty = policy layer). It is not specific to
-- this one leader: 6 live school-admin tags today belong to a user who is NOT
-- their school's admin_user_id pointer, and every one of them is blind to
-- their own school's classes.
--
-- THE FIX. Teach the function the second, now-canonical representation of
-- "admin of this school". A school admin is EITHER the schools.admin_user_id
-- pointer (the founding admin) OR the holder of a live school tag with
-- role_in_context='admin'. Same question, both spellings.
--
-- WHY THIS IS SAFE — an 'admin' tag cannot be self-minted. Verified live
-- against user_tags_insert / user_tags_update WITH CHECK: an `authenticated`
-- caller may only write tags for themselves AND only where role_in_context IS
-- DISTINCT FROM 'teacher' AND IS DISTINCT FROM 'admin'. Both privileged roles
-- are service-role/god-only, so honouring the admin tag grants exactly what a
-- server-side grant already decided. This mirrors is_class_teacher(), which
-- has always trusted the service-role-written 'teacher' class tag the same way.
--
-- SCOPE. is_school_admin_of() is referenced by exactly ONE policy in the live
-- DB (classes_select) — verified via pg_policy before editing — so the blast
-- radius is that policy and nothing else. Deliberately NARROW: the predicate
-- requires role_in_context='admin', so a school tag with role_in_context
-- 'teacher' (every ordinary member of staff, including the supply teacher)
-- still grants no school-wide class read. Canaried per doctrine rule 3:
-- supabase/secfix-toolkit/canary_school_admin_tag_recognised.cjs.

CREATE OR REPLACE FUNCTION public.is_school_admin_of(p_school_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    -- The founding admin: the school's own pointer column.
    SELECT 1 FROM public.schools s
    WHERE s.id = p_school_id
      AND s.admin_user_id = (auth.uid())::text
  ) OR EXISTS (
    -- Every subsequent admin: the service-role-written school admin tag.
    SELECT 1 FROM public.user_tags ut
    WHERE ut.user_id = (auth.uid())::text
      AND ut.tag_type = 'school'
      AND ut.role_in_context = 'admin'
      AND ut.removed_at IS NULL
      AND ut.tag_value = 'SCHOOL:' || (p_school_id)::text
  );
$function$;

NOTIFY pgrst, 'reload schema';
