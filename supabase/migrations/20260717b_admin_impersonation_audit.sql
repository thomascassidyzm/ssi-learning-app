-- admin_impersonation_audit — server-side audit trail for the ssi_admin
-- "View as" feature (read-only impersonation of a teacher/school-admin/
-- govt-admin persona so support staff can see exactly what that person
-- sees — e.g. "Lucy shows 0 minutes").
--
-- Table posture at creation (RLS doctrine rule 7, CLAUDE.md): service-role
-- only. RLS is enabled with ZERO policies (deny-by-default for anon/
-- authenticated), and — because Supabase's schema-wide default privileges
-- grant ALL on new tables to anon/authenticated as well as service_role —
-- this migration explicitly REVOKEs those default grants in the same file
-- (doctrine rule 2). Every row is written by api/admin/view-as.ts using the
-- service-role client; no client ever reads or writes this table directly.
--
-- This IS the compliance story for the feature (GDPR legitimate-interest
-- support access): every "view as" start is logged with who, whom, when,
-- and from where (IP + user agent); ended_at is filled in on exit or left
-- null if the tab just closed (sessionStorage-backed act-as clears itself,
-- so an open-ended row is a truthful record of "session ended without an
-- explicit exit click", not a bug).
--
-- NOTE: this table was already created live against the shared DB on
-- 2026-07-17 (via supabase/secfix-toolkit/run.cjs) before this file was
-- re-committed after a working-tree loss (see
-- project_shared_working_directory_concurrent_agents.md) — CREATE TABLE IF
-- NOT EXISTS / NOTIFY make re-applying this file a no-op.

CREATE TABLE IF NOT EXISTS public.admin_impersonation_audit (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id     text NOT NULL,
    target_user_id    text NOT NULL,
    target_role       text NOT NULL,
    target_name       text,
    target_school_id  uuid,
    started_at        timestamp with time zone NOT NULL DEFAULT now(),
    ended_at          timestamp with time zone,
    ip_address        text,
    user_agent        text
);

COMMENT ON TABLE public.admin_impersonation_audit IS
  'Audit trail for ssi_admin "View as" read-only impersonation. Service-role-only (RLS on, no policies) — written only by api/admin/view-as.ts. The compliance record for this legitimate-interest support-access feature.';
COMMENT ON COLUMN public.admin_impersonation_audit.admin_user_id IS
  'auth uid (learners.user_id) of the ssi_admin who viewed as the persona.';
COMMENT ON COLUMN public.admin_impersonation_audit.target_user_id IS
  'auth uid (learners.user_id) of the teacher/school_admin/govt_admin persona viewed.';
COMMENT ON COLUMN public.admin_impersonation_audit.target_role IS
  'Persona role at the time of viewing: teacher | school_admin | govt_admin.';

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_audit_admin ON public.admin_impersonation_audit (admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_audit_target ON public.admin_impersonation_audit (target_user_id, started_at DESC);

ALTER TABLE public.admin_impersonation_audit ENABLE ROW LEVEL SECURITY;
-- Deliberately zero CREATE POLICY statements — deny-by-default for anon/authenticated.

REVOKE ALL ON TABLE public.admin_impersonation_audit FROM anon;
REVOKE ALL ON TABLE public.admin_impersonation_audit FROM authenticated;
GRANT ALL ON TABLE public.admin_impersonation_audit TO service_role;

NOTIFY pgrst, 'reload schema';
