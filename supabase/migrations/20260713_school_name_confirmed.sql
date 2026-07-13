-- Invite-born admin single-OTP flow: schools.name_confirmed drives the
-- "confirm your school's name" first-run card on DashboardView.vue, the same
-- pattern as groups.name_confirmed (20260713_region_tier_slice2.sql, §1d).
--
-- An invite-born school (api/code/redeem.ts's school_admin branch) is named
-- from the inviting LEADER's guess (invite_codes.metadata.school_name), not
-- the admin's own choice — unconfirmed until the admin saves it once. Every
-- EXISTING school and every self-serve school (api/onboarding/provision.ts's
-- 'My school' placeholder, renamed anytime via SettingsView with no forced
-- first-run prompt) backfills/defaults to true — this card is deliberately
-- scoped to invite-born admins only.

ALTER TABLE public.schools ADD COLUMN name_confirmed boolean;
UPDATE public.schools SET name_confirmed = true WHERE name_confirmed IS NULL;
ALTER TABLE public.schools ALTER COLUMN name_confirmed SET DEFAULT true;
ALTER TABLE public.schools ALTER COLUMN name_confirmed SET NOT NULL;

-- Expose through school_summary (CREATE OR REPLACE VIEW cannot reorder/insert
-- columns, only append — same gotcha as the forgiving-codes / group_summary
-- migrations — name_confirmed goes last).
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
    s.name_confirmed
   FROM ((((public.schools s
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
          WHERE (c.school_id = s.id)) ph ON (true));

NOTIFY pgrst, 'reload schema';
