-- Chepstow-scenario finding (2026-08-07): a school created through the real
-- /schools1 self-serve signup path carries is_test = false always, so any
-- soak-test/E2E school an agent names by hand (the "ZZ ..." convention)
-- silently counts toward real rollups until someone remembers to flag it.
--
-- The one-off bad row (schools.id 648185c9-...) was hand-corrected already.
-- This migration closes the two AGGREGATE views that sum/count across many
-- schools and did not exclude is_test — group_summary (api/school/group-
-- summary.ts, the govt/school-admin "group node" dashboard) and
-- region_summary (packages/player-vue useSchoolData.ts + govt dashboard,
-- "Aggregated regional statistics... NO individual data exposed").
--
-- school_summary is deliberately left untouched: it is always queried
-- scoped to a specific school_id (school/roster.ts, groups/[id]/home.ts,
-- useSchoolData.ts) — a test school's own admin still needs a working
-- dashboard for QA, so per-school reads must see the school regardless of
-- is_test. Only the views that AGGREGATE ACROSS schools need the filter.

CREATE OR REPLACE VIEW public.group_summary WITH (security_invoker='on') AS
 SELECT g.id AS group_id,
    g.name AS group_name,
    g.path AS group_path,
    count(DISTINCT s.id) AS school_count,
    COALESCE(sum(ss.teacher_count), (0)::numeric) AS teacher_count,
    COALESCE(sum(ss.class_count), (0)::numeric) AS class_count,
    COALESCE(sum(ss.student_count), (0)::numeric) AS student_count,
    COALESCE(sum(ss.total_practice_hours), (0)::numeric) AS total_practice_hours,
    g.name_confirmed,
    COALESCE(sum(ss.staff_practice_hours), (0)::numeric) AS staff_practice_hours
   FROM ((public.groups g
     LEFT JOIN public.schools s ON ((s.group_id IN ( SELECT public.get_subtree_group_ids(g.id) AS get_subtree_group_ids)) AND s.is_test = false))
     LEFT JOIN public.school_summary ss ON ((ss.school_id = s.id)))
  GROUP BY g.id, g.name, g.path, g.name_confirmed;

CREATE OR REPLACE VIEW public.region_summary WITH (security_invoker='on') AS
 SELECT code AS region_code,
    name AS region_name,
    country_code,
    primary_language,
    ( SELECT count(*) AS count
           FROM public.schools s
          WHERE (s.region_code = r.code) AND s.is_test = false) AS school_count,
    ( SELECT count(DISTINCT ut.user_id) AS count
           FROM (public.schools s
             JOIN public.user_tags ut ON (((ut.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (ut.tag_type = 'school'::text) AND (ut.role_in_context = 'teacher'::text) AND (ut.removed_at IS NULL))))
          WHERE (s.region_code = r.code) AND s.is_test = false) AS teacher_count,
    ( SELECT count(DISTINCT ut2.user_id) AS count
           FROM ((public.schools s
             JOIN public.classes c ON ((c.school_id = s.id)))
             JOIN public.user_tags ut2 ON (((ut2.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut2.tag_type = 'class'::text) AND (ut2.role_in_context = 'student'::text) AND (ut2.removed_at IS NULL))))
          WHERE (s.region_code = r.code) AND s.is_test = false) AS student_count,
    ( SELECT COALESCE(((sum(sess.duration_seconds))::numeric / 3600.0), (0)::numeric) AS "coalesce"
           FROM ((((public.schools s
             JOIN public.classes c ON ((c.school_id = s.id)))
             JOIN public.user_tags ut ON (((ut.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut.tag_type = 'class'::text) AND (ut.role_in_context = 'student'::text) AND (ut.removed_at IS NULL))))
             JOIN public.learners l ON ((l.user_id = ut.user_id)))
             JOIN public.sessions sess ON (((sess.learner_id = l.id) AND (sess.course_id = c.course_code))))
          WHERE (s.region_code = r.code) AND s.is_test = false) AS total_practice_hours
   FROM public.regions r;

COMMENT ON VIEW public.region_summary IS 'Aggregated regional statistics. Used by govt admin dashboard. NO individual data exposed. Excludes is_test schools (2026-08-07).';

NOTIFY pgrst, 'reload schema';
