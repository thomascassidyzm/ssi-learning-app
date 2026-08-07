-- Founding-admin membership, read half (Tom's ruling, 2026-08-06).
--
-- The write half (api/_utils/schoolStaff.ts) gives a school's FOUNDING admin —
-- the person in schools.admin_user_id — the user_tags SCHOOL: row she never
-- got, with role_in_context='admin' (the truthful role, identical to what the
-- school_admin_join CLAIM path has always written). This is the read half.
--
-- 20260718_headline_hours_include_staff_practice already defined "staff" as
-- role_in_context IN ('teacher','admin') for staff_practice_hours — so the tag
-- alone fixes a school's HEADLINE MINUTES. But teacher_count in the very same
-- view still filtered 'teacher' STRICTLY, so the newly-tagged admin's practice
-- would land in the headline while she stayed uncounted as a person: a school
-- reading "2 teachers · incl. 76m staff practice" from three people. That is
-- the same split-definition defect in miniature.
--
-- One definition of staff across the estate. teacher_count here, and
-- region_summary.teacher_count (the govt-tier roll-up of the same question),
-- both widen to teacher OR admin — matching staff_practice_hours, the
-- /api/school/roster staff list, useTeachersData, the group node rollup
-- (api/_utils/groupRollups.ts) and the group home lenses.
--
-- No double counting: user_tags_active_natural_key is UNIQUE on
-- (user_id, tag_type, tag_value) WHERE removed_at IS NULL, so a user holds at
-- most ONE active tag per school — she cannot be counted as both.
--
-- Deliberately NOT widened (genuinely teacher-only, not staff-list reads):
--   * api/school/remove-staff.ts's target lookup — an admin must not be
--     removable from her own school as though she were a teacher.
--   * every tag_type='class' read (class_teachers, is_class_teacher,
--     api/teacher/class-teachers.ts) — class teaching is a different relation.
--   * class-level student stats — unchanged, students only.
--
-- CREATE OR REPLACE VIEW can change an existing column's defining expression as
-- long as name/type/position are preserved; teacher_count keeps its slot and
-- bigint type, so dependent views (group_summary sums it) stay valid.

CREATE OR REPLACE VIEW public.school_summary WITH (security_invoker='on') AS
 SELECT s.id AS school_id,
    s.school_name,
    s.region_code,
    s.group_id,
    s.admin_user_id,
    COALESCE(tc.teacher_count, (0)::bigint) AS teacher_count,
    COALESCE(cc.class_count, (0)::bigint) AS class_count,
    COALESCE(sc.student_count, (0)::bigint) AS student_count,
    (COALESCE(ph.total_practice_hours, (0)::numeric) + COALESCE(sp.staff_practice_hours, (0)::numeric)) AS total_practice_hours,
    s.name_confirmed,
    s.teacher_join_code,
    s.admin_join_code,
    s.created_at,
    (s.admin_user_id IS NOT NULL OR at.has_admin_tag) AS has_admin,
    COALESCE(sp.staff_practice_hours, (0)::numeric) AS staff_practice_hours
   FROM (((((( public.schools s
     LEFT JOIN LATERAL ( SELECT count(*) AS teacher_count
           FROM public.user_tags ut
          WHERE ((ut.tag_type = 'school'::text) AND (ut.tag_value = ('SCHOOL:'::text || s.id)) AND (ut.role_in_context = ANY (ARRAY['teacher'::text, 'admin'::text])) AND (ut.removed_at IS NULL))) tc ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS class_count
           FROM public.classes c
          WHERE ((c.school_id = s.id) AND (c.is_active = true))) cc ON (true))
     LEFT JOIN LATERAL ( SELECT count(DISTINCT csp.learner_id) AS student_count
           FROM (public.class_student_progress csp
             JOIN public.classes c ON ((c.id = csp.class_id)))
          WHERE (c.school_id = s.id)) sc ON (true))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(csp.total_practice_seconds), (0)::numeric) / (3600)::numeric) AS total_practice_hours
           FROM (public.class_student_progress csp
             JOIN public.classes c ON ((c.id = csp.class_id)))
          WHERE (c.school_id = s.id)) ph ON (true))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(sess.duration_seconds), 0)::numeric / (3600)::numeric) AS staff_practice_hours
           FROM public.sessions sess
          WHERE (sess.learner_id IN ( SELECT DISTINCT l.id
                   FROM (public.user_tags ut3
                     JOIN public.learners l ON ((l.user_id = ut3.user_id)))
                  WHERE ((ut3.tag_type = 'school'::text) AND (ut3.tag_value = ('SCHOOL:'::text || s.id)) AND (ut3.role_in_context = ANY (ARRAY['teacher'::text, 'admin'::text])) AND (ut3.removed_at IS NULL))))) sp ON (true))
     LEFT JOIN LATERAL ( SELECT EXISTS ( SELECT 1
           FROM public.user_tags ut2
          WHERE ((ut2.tag_type = 'school'::text) AND (ut2.tag_value = ('SCHOOL:'::text || s.id)) AND (ut2.role_in_context = 'admin'::text) AND (ut2.removed_at IS NULL))) AS has_admin_tag) at ON (true));

-- Govt tier asks the same question one level up.
CREATE OR REPLACE VIEW public.region_summary WITH (security_invoker='on') AS
 SELECT code AS region_code,
    name AS region_name,
    country_code,
    primary_language,
    ( SELECT count(*) AS count
           FROM public.schools s
          WHERE (s.region_code = r.code)) AS school_count,
    ( SELECT count(DISTINCT ut.user_id) AS count
           FROM (public.schools s
             JOIN public.user_tags ut ON (((ut.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (ut.tag_type = 'school'::text) AND (ut.role_in_context = ANY (ARRAY['teacher'::text, 'admin'::text])) AND (ut.removed_at IS NULL))))
          WHERE (s.region_code = r.code)) AS teacher_count,
    ( SELECT count(DISTINCT ut2.user_id) AS count
           FROM ((public.schools s
             JOIN public.classes c ON ((c.school_id = s.id)))
             JOIN public.user_tags ut2 ON (((ut2.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut2.tag_type = 'class'::text) AND (ut2.role_in_context = 'student'::text) AND (ut2.removed_at IS NULL))))
          WHERE (s.region_code = r.code)) AS student_count,
    ( SELECT COALESCE(((sum(sess.duration_seconds))::numeric / 3600.0), (0)::numeric) AS "coalesce"
           FROM ((((public.schools s
             JOIN public.classes c ON ((c.school_id = s.id)))
             JOIN public.user_tags ut ON (((ut.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut.tag_type = 'class'::text) AND (ut.role_in_context = 'student'::text) AND (ut.removed_at IS NULL))))
             JOIN public.learners l ON ((l.user_id = ut.user_id)))
             JOIN public.sessions sess ON (((sess.learner_id = l.id) AND (sess.course_id = c.course_code))))
          WHERE (s.region_code = r.code)) AS total_practice_hours
   FROM public.regions r;

NOTIFY pgrst, 'reload schema';
