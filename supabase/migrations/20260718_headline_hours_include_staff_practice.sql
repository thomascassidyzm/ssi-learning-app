-- Founder ruling (Tom, 2026-07-18): a school's HEADLINE hours should include
-- staff's OWN practice, not just students'. "A more valid testament to true
-- engagement." Motivating case: trial schools (Chepstow) where only staff have
-- practiced showed a bleak headline 0 — teacher own-practice became visible
-- per-teacher on 2026-07-17 (own_practice_minutes in /api/school/roster), but
-- the school/group headline still summed students only.
--
-- What changes here (DB-first, single source of truth so every consumer —
-- roster.ts, group-summary.ts, the direct legacy view reads, and the group
-- rollup — inherits it at once):
--   * school_summary.total_practice_hours  = student practice + staff practice
--   * school_summary.staff_practice_hours  = staff practice ALONE (NEW column,
--     so the UI can render the honest "incl. Xm staff practice" composition
--     line instead of silently inflating the headline).
--   * group_summary sums both, so org rollups stay consistent.
--
-- "Staff" = every user tagged to the school as teacher OR admin (role_in_context
-- in ('teacher','admin')), summed over ALL their learner accounts' sessions —
-- the same all-sessions basis the per-teacher Own-practice column uses. Staff
-- practice is disjoint from student practice: class_student_progress only sees
-- role_in_context='student' tags, so there is no double count. DISTINCT learner
-- ids guard against a user carrying both a teacher and admin tag in one school.
--
-- Class-level student stats deliberately stay students-only (a class's teacher
-- practising is school engagement, not that class's progress) — untouched here;
-- this migration only touches the school/group headline rollups.
--
-- CREATE OR REPLACE VIEW can only APPEND columns (not reorder/insert), but it
-- CAN change an existing column's defining expression as long as name/type/
-- position are preserved — so total_practice_hours keeps its slot and type
-- (numeric) while gaining the staff term; staff_practice_hours goes last.
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
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(sess.duration_seconds), 0)::numeric / (3600)::numeric) AS staff_practice_hours
           FROM public.sessions sess
          WHERE (sess.learner_id IN ( SELECT DISTINCT l.id
                   FROM (public.user_tags ut3
                     JOIN public.learners l ON ((l.user_id = ut3.user_id)))
                  WHERE ((ut3.tag_type = 'school'::text) AND (ut3.tag_value = ('SCHOOL:'::text || s.id)) AND (ut3.role_in_context = ANY (ARRAY['teacher'::text, 'admin'::text])) AND (ut3.removed_at IS NULL))))) sp ON (true))
     LEFT JOIN LATERAL ( SELECT EXISTS ( SELECT 1
           FROM public.user_tags ut2
          WHERE ((ut2.tag_type = 'school'::text) AND (ut2.tag_value = ('SCHOOL:'::text || s.id)) AND (ut2.role_in_context = 'admin'::text) AND (ut2.removed_at IS NULL))) AS has_admin_tag) at ON (true));

-- group_summary sums school_summary — total_practice_hours now already carries
-- staff, so the org headline inherits it. Append staff_practice_hours so the
-- group-level view can render the same honest composition line.
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
     LEFT JOIN public.schools s ON ((s.group_id IN ( SELECT public.get_subtree_group_ids(g.id) AS get_subtree_group_ids))))
     LEFT JOIN public.school_summary ss ON ((ss.school_id = s.id)))
  GROUP BY g.id, g.name, g.path, g.name_confirmed;

NOTIFY pgrst, 'reload schema';
