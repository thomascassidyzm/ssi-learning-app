-- ============================================================================
-- SECURITY FIX #15 (Lane B1) — class_sessions backfill + full RLS enable;
--                              user_tags relink bridge + full RLS enable
-- ============================================================================
-- Design: ~/Desktop/SSi-secfix-2026-06-09/LANE_B_identity_design.md
-- Pairs with app commit (same dev push): LearningPlayer.vue writes the AUTH
-- uid into class_sessions.teacher_user_id (was learners.id; guests now skip
-- logging), and useAuth.ts re-points user_tags via relink_user_tags() below.
--
-- FACTS (verified live 2026-06-10):
--   * class_sessions.teacher_user_id was 3-generation dirty: 81 rows held
--     learners.id (all 81 map to learners WITH auth uids), 76 held auth uid,
--     8 held guest-<uuid> (demo garbage — Tom approved wipe). After backfill:
--     uniformly auth uid, simple own-row predicates, matching classes.
--   * user_tags: secfix_08 had revoked authenticated INSERT (anti-self-promote
--     partial). This migration re-grants INSERT behind a forgery-blocking
--     policy and turns RLS on with principal-scoped read/update branches
--     (schools.admin_user_id / classes.teacher_user_id), per the data-arch
--     "remove centralised to principal" model.
--   * Demo schools data contains Clerk-era fake ids (teacher-001,
--     user_2bre_…) that can never satisfy auth.uid() policies — those rows go
--     dark under RLS by design; demo data is to be regenerated to conform.

-- ====== user_tags re-point bridge ======
-- Callable only while signed in; only moves tags from an ORPHANED identity
-- (one no learners row currently holds) — the multi-email link flow orphans
-- the old auth uid by re-pointing learners.user_id first (useAuth.ts).
CREATE OR REPLACE FUNCTION public.relink_user_tags(old_user_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'relink_user_tags: permission denied (not authenticated)';
  END IF;
  IF old_user_id IS NULL OR old_user_id = (auth.uid())::text THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.learners WHERE user_id = old_user_id) THEN
    RAISE EXCEPTION 'relink_user_tags: permission denied (old identity still active)';
  END IF;
  UPDATE public.user_tags SET user_id = (auth.uid())::text
  WHERE user_id = old_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.relink_user_tags(text) FROM public;
GRANT EXECUTE ON FUNCTION public.relink_user_tags(text) TO authenticated;

-- ====== class_sessions: make the data uniform, then enable ======
-- 81 learner-PK rows -> their learner's auth uid
UPDATE public.class_sessions cs
SET teacher_user_id = l.user_id
FROM public.learners l
WHERE l.id::text = cs.teacher_user_id
  AND l.user_id IS NOT NULL;

-- rows that can never map to an identity (guest-<uuid> demo rows): drop
DELETE FROM public.class_sessions cs
WHERE NOT EXISTS (SELECT 1 FROM public.learners l WHERE l.user_id = cs.teacher_user_id);

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='class_sessions' LOOP
    EXECUTE format('DROP POLICY %I ON public.class_sessions', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_sessions FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.class_sessions FROM authenticated;

CREATE POLICY class_sessions_teacher_insert ON public.class_sessions
  FOR INSERT TO authenticated
  WITH CHECK (teacher_user_id = (auth.uid())::text);
CREATE POLICY class_sessions_teacher_update ON public.class_sessions
  FOR UPDATE TO authenticated
  USING (teacher_user_id = (auth.uid())::text)
  WITH CHECK (teacher_user_id = (auth.uid())::text);
CREATE POLICY class_sessions_read ON public.class_sessions
  FOR SELECT TO authenticated
  USING (
    teacher_user_id = (auth.uid())::text
    OR is_god_user()
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_sessions.class_id
        AND (c.teacher_user_id = (auth.uid())::text
             OR EXISTS (SELECT 1 FROM public.schools s
                        WHERE s.id = c.school_id
                          AND s.admin_user_id = (auth.uid())::text))
    )
  );

-- ====== user_tags: full enable ======
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='user_tags' LOOP
    EXECUTE format('DROP POLICY %I ON public.user_tags', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_tags FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_tags FROM authenticated;
GRANT INSERT ON public.user_tags TO authenticated;  -- re-grant (secfix_08), policy-gated below

-- read: own tags; god; school principal sees school-scoped tags; class teacher
-- (or the class's school principal) sees class-scoped tags
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT TO authenticated
  USING (
    user_id = (auth.uid())::text
    OR is_god_user()
    OR EXISTS (SELECT 1 FROM public.schools s
               WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
                 AND s.admin_user_id = (auth.uid())::text)
    OR EXISTS (SELECT 1 FROM public.classes c
               LEFT JOIN public.schools s2 ON s2.id = c.school_id
               WHERE user_tags.tag_value = 'CLASS:' || c.id::text
                 AND (c.teacher_user_id = (auth.uid())::text
                      OR s2.admin_user_id = (auth.uid())::text))
  );

-- insert: self-serve may never claim teacher/admin (privileged tags arrive via
-- the service-role redeem / create-staff routes); god unrestricted
CREATE POLICY user_tags_insert ON public.user_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    is_god_user()
    OR (user_id = (auth.uid())::text
        AND role_in_context IS DISTINCT FROM 'teacher'
        AND role_in_context IS DISTINCT FROM 'admin')
  );

-- update: own non-privileged rows; god; principals manage tags in their scope
-- (TeachersView/ClassDetail removed_at soft-deletes). WITH CHECK blocks
-- self-escalation: a non-principal cannot set teacher/admin on any row.
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE TO authenticated
  USING (
    user_id = (auth.uid())::text
    OR is_god_user()
    OR EXISTS (SELECT 1 FROM public.schools s
               WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
                 AND s.admin_user_id = (auth.uid())::text)
    OR EXISTS (SELECT 1 FROM public.classes c
               LEFT JOIN public.schools s2 ON s2.id = c.school_id
               WHERE user_tags.tag_value = 'CLASS:' || c.id::text
                 AND (c.teacher_user_id = (auth.uid())::text
                      OR s2.admin_user_id = (auth.uid())::text))
  )
  WITH CHECK (
    is_god_user()
    OR (user_id = (auth.uid())::text
        AND role_in_context IS DISTINCT FROM 'teacher'
        AND role_in_context IS DISTINCT FROM 'admin')
    OR EXISTS (SELECT 1 FROM public.schools s
               WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
                 AND s.admin_user_id = (auth.uid())::text)
    OR EXISTS (SELECT 1 FROM public.classes c
               LEFT JOIN public.schools s2 ON s2.id = c.school_id
               WHERE user_tags.tag_value = 'CLASS:' || c.id::text
                 AND (c.teacher_user_id = (auth.uid())::text
                      OR s2.admin_user_id = (auth.uid())::text))
  );

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: DISABLE ROW LEVEL SECURITY on both tables + re-grant; the
-- class_sessions backfill is one-way (8 guest demo rows deleted) — restore
-- from backup only, accepted under the demo-data wipe licence (Tom 2026-06-10).
