-- is_class_teacher(uuid, text) is a SECURITY DEFINER boolean oracle granted to
-- anon and authenticated. Unlike its sibling overload is_class_teacher(uuid) —
-- which checks auth.uid() internally and stays in place — this two-arg form
-- takes an explicit p_uid text with no auth check at all: any caller holding
-- nothing but the public anon key can pass ANY user id and ANY class id and
-- learn whether that user teaches that class.
--
-- Found by tools/definer-grant-standing-check.mjs (#333) as the one genuinely
-- new finding on 2026-09-07; the check's other five hits were the pre-existing
-- allowlisted is_ssi_admin()-gated functions and the already-scoped
-- admin_practice_minutes_by_course residual (owned by a separate job).
--
-- Verified live and by grep across ssi-learning-app AND ssi-dashboard-v7-clean:
-- every real caller (RLS policies, migrations 20260801c/20260806*/20260807*)
-- uses the ONE-arg form is_class_teacher(id), which is left untouched. The
-- two-arg form has no caller anywhere in the estate — dead API surface with
-- the same "no caller, no auth check" shape as #317/#324's activate_brief_version.
--
-- proacl carries no bare PUBLIC (`=X/`) grant on this overload, so a direct
-- REVOKE from anon, authenticated is sufficient (no `FROM PUBLIC` needed).
-- service_role keeps EXECUTE, so any real service-role caller is untouched;
-- if something does go dark, the repair is one GRANT.

REVOKE EXECUTE ON FUNCTION public.is_class_teacher(uuid, text) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
