-- demo_orgs — tracking table for the self-serve "Create demo school" admin
-- tool (packages/player-vue/src/views/admin/AdminDemoSchools.vue,
-- api/admin/demo-schools.ts). Lets Nick (Head of Partnerships) provision a
-- full showcase org for a prospect without engineering help.
--
-- Why a dedicated table rather than deriving the list from `schools`/`groups`
-- WHERE is_test: every school row in the DB is currently is_test (soak/E2E/
-- other demo scripts included — see boardMetrics.ts comment), so is_test alone
-- can't tell "a sales demo this tool created" apart from unrelated test data.
-- One row per generation run gives an O(1), unambiguous list/expire surface.
--
-- Table posture at creation (RLS doctrine rule 7, CLAUDE.md): service-role
-- only. RLS enabled, ZERO policies (deny-by-default for anon/authenticated).
-- The only access path is api/admin/demo-schools.ts (verifyAdmin-gated,
-- service-role client) and api/cron/expire-demo-schools.ts (CRON_SECRET-gated).

CREATE TABLE IF NOT EXISTS public.demo_orgs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    timestamp with time zone NOT NULL DEFAULT now(),
    created_by    text NOT NULL,
    prospect_name text NOT NULL,
    org_shape     text NOT NULL CHECK (org_shape IN ('single_school', 'group', 'government_region')),
    course_code   text NOT NULL,
    group_id      uuid REFERENCES public.groups(id),
    school_id     uuid REFERENCES public.schools(id),
    expires_at    timestamp with time zone NOT NULL,
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
    expired_at    timestamp with time zone,
    -- Snapshot at creation time: staff (role/name/email/learner_id), counts
    -- (schools/teachers/classes/learners), org display name. The definitive
    -- source for the re-viewable result card — never re-derived by joining
    -- across schools/user_tags at read time.
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.demo_orgs IS
  'Sales-showcase demo orgs created via /admin/demo-schools. Service-role-only (RLS on, no policies) — every access goes through api/admin/demo-schools.ts (admin-gated) or api/cron/expire-demo-schools.ts (CRON_SECRET-gated).';
COMMENT ON COLUMN public.demo_orgs.metadata IS
  'Snapshot at creation: { orgName, staff: [{role, name, email, learnerId}], counts: {schools, teachers, classes, learners} }. The result card reads this, not a live join.';

CREATE INDEX IF NOT EXISTS idx_demo_orgs_status ON public.demo_orgs (status, expires_at);

ALTER TABLE public.demo_orgs ENABLE ROW LEVEL SECURITY;
-- Deliberately zero CREATE POLICY statements — deny-by-default for anon/authenticated.

REVOKE ALL ON TABLE public.demo_orgs FROM anon;
REVOKE ALL ON TABLE public.demo_orgs FROM authenticated;
GRANT ALL ON TABLE public.demo_orgs TO service_role;

NOTIFY pgrst, 'reload schema';
