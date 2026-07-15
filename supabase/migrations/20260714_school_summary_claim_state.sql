-- Leader "Add school" one-primitive flow (2026-07-14): the leader's
-- /schools/all table needs, per row, (a) the copyable admin/teacher join
-- links and (b) whether the school has been claimed by an admin yet, so it
-- can show "awaiting admin" honestly.
--
-- The claim signal is NOT admin_user_id alone. A leader-created school's
-- admin_join_code redeems via api/code/redeem.ts's `school_admin_join`
-- branch, which only inserts a user_tags row (role_in_context='admin') —
-- it never sets schools.admin_user_id (that column is only ever written by
-- the legacy `school_admin` invite-code branch being retired, or api/govt
-- /create-school.ts leaving it NULL by design). So "claimed" = either
-- admin_user_id is set OR a live admin user_tags row exists for the school.
--
-- CREATE OR REPLACE VIEW cannot reorder/insert columns, only append — same
-- gotcha as the name_confirmed migrations — new columns go last.
CREATE OR REPLACE VIEW public.school_summary WITH (security_invoker='on') AS
 SELECT s.id AS school_id,
    s.school_name,
    s.region_code,
    s.group_id,
    s.admin_user_id,
    COALESCE(tc.teacher_count, (0)::bigint) AS teacher_count,
    COALESCE(cc.class_count, (0)::bigint) AS class_count,
    COALESCE(sc.student_count, (0)::bigint) AS student_count,
    COALESCE(ph.total_practice_hours, (0)::numeric) AS total_practice_hours,
    s.name_confirmed,
    s.teacher_join_code,
    s.admin_join_code,
    s.created_at,
    (s.admin_user_id IS NOT NULL OR at.has_admin_tag) AS has_admin
   FROM ((((( public.schools s
     LEFT JOIN LATERAL ( SELECT count(*) AS teacher_count
           FROM public.user_tags ut
          WHERE ((ut.tag_type = 'school'::text) AND (ut.tag_value = ('SCHOOL:'::text || s.id)) AND (ut.role_in_context = 'teacher'::text) AND (ut.removed_at IS NULL))) tc ON (true))
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
     LEFT JOIN LATERAL ( SELECT EXISTS ( SELECT 1
           FROM public.user_tags ut2
          WHERE ((ut2.tag_type = 'school'::text) AND (ut2.tag_value = ('SCHOOL:'::text || s.id)) AND (ut2.role_in_context = 'admin'::text) AND (ut2.removed_at IS NULL))) AS has_admin_tag) at ON (true));

NOTIFY pgrst, 'reload schema';
