-- Region-tier slice 2: expose groups.name_confirmed through group_summary so
-- the dashboard's "name your region" first-run card (design §1d) can decide
-- to show without a second round-trip. CREATE OR REPLACE VIEW cannot
-- reorder/insert columns, only append (same gotcha as the forgiving-codes and
-- invite_code_validation migrations) — name_confirmed goes last.
CREATE OR REPLACE VIEW public.group_summary WITH (security_invoker='on') AS
 SELECT g.id AS group_id,
    g.name AS group_name,
    g.path AS group_path,
    count(DISTINCT s.id) AS school_count,
    COALESCE(sum(ss.teacher_count), (0)::numeric) AS teacher_count,
    COALESCE(sum(ss.class_count), (0)::numeric) AS class_count,
    COALESCE(sum(ss.student_count), (0)::numeric) AS student_count,
    COALESCE(sum(ss.total_practice_hours), (0)::numeric) AS total_practice_hours,
    g.name_confirmed AS name_confirmed
   FROM ((public.groups g
     LEFT JOIN public.schools s ON ((s.group_id IN ( SELECT public.get_subtree_group_ids(g.id) AS get_subtree_group_ids))))
     LEFT JOIN public.school_summary ss ON ((ss.school_id = s.id)))
  GROUP BY g.id, g.name, g.path, g.name_confirmed;

NOTIFY pgrst, 'reload schema';
