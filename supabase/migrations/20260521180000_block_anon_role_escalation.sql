-- ============================================
-- Block anon role escalation via direct INSERT/UPDATE on learners
-- ============================================
-- Date: 2026-05-21
--
-- Problem
-- -------
-- RLS is disabled globally on learners, govt_admins, invite_codes.
-- An anon or authenticated client can POST directly to PostgREST:
--   INSERT INTO learners (user_id, platform_role) VALUES ('x', 'ssi_admin')
-- and instantly become an SSi admin. Same shape for govt_admins /
-- invite_codes — admin-only tables with no client-side legitimate writes.
--
-- views/admin/SchoolsSetup.vue:384,407,416 currently uses these exact
-- inserts as legitimate admin UI. Same call from any browser succeeds.
--
-- Fix
-- ---
-- Use column- and table-level REVOKEs at the PostgREST role layer so
-- escalation is blocked even with RLS off. Admin actions go via API
-- routes (service-role key) which bypass the GRANT layer entirely.
--
-- What this does
-- --------------
-- 1. learners.platform_role / educational_role: REVOKE UPDATE from
--    anon + authenticated. Client can still UPDATE its own
--    verified_emails, user_id, display_name, preferences (used by
--    useAuth.ts:204-263 multi-email flow).
-- 2. learners INSERT: REVOKE entirely from anon + authenticated.
--    New-learner creation now happens server-side via the restored
--    handle_new_user() trigger (was dropped by the Clerk migration
--    in 2025-12 which was never properly shipped). The client-side
--    INSERT fallback at useAuth.ts:255 will fail with permission
--    denied — that path was the exploit vector and is no longer
--    reachable.
-- 3. govt_admins INSERT/UPDATE: REVOKE from anon + authenticated.
--    No legitimate client writes; all admin UI must move to /api/admin/*.
-- 4. invite_codes INSERT/UPDATE: REVOKE from anon + authenticated.
--    Same — admin-only writes; /api/invite/create is the legit path.
--
-- Expected breakage (intentional — needs follow-up)
-- -------------------------------------------------
-- views/admin/SchoolsSetup.vue lines 384 (learners insert), 407
-- (govt_admins insert), 416 (invite_codes insert) WILL all return
-- "permission denied" after this lands. The admin UI for creating
-- govt_admin accounts is temporarily broken until a follow-up moves
-- those three calls into a single /api/admin/create-govt-admin
-- endpoint that uses the service-role client.
--
-- Restoring the auth-user trigger
-- -------------------------------
-- The Clerk migration (20251219120000) dropped handle_new_user() and
-- the on_auth_user_created trigger on auth.users. Clerk was never
-- fully shipped — Supabase Auth is canonical — so we restore the
-- trigger here, adjusted for the TEXT user_id column the Clerk
-- migration also produced. SECURITY DEFINER means the trigger runs
-- as the table owner and bypasses the REVOKE on INSERT.

BEGIN;

-- ============================================
-- 1. learners — column-level UPDATE block on role fields
-- ============================================
-- Blocks: UPDATE learners SET platform_role = 'ssi_admin' WHERE ...
-- Allows: UPDATE learners SET verified_emails = ARRAY[...] (and
-- other non-role columns). Existing RLS for own-row UPDATE still
-- applies on top of this.

REVOKE UPDATE (platform_role, educational_role) ON learners FROM anon, authenticated;

-- ============================================
-- 2. learners — block INSERT entirely
-- ============================================
-- Blocks ALL direct client inserts to learners (including the
-- exploit shape with platform_role baked into the row). The
-- restored handle_new_user() trigger below creates the row on
-- signup via SECURITY DEFINER, bypassing this REVOKE.

REVOKE INSERT ON learners FROM anon, authenticated;

-- ============================================
-- 3. govt_admins — admin-only table, no legit client writes
-- ============================================

REVOKE INSERT, UPDATE ON govt_admins FROM anon, authenticated;

-- ============================================
-- 4. invite_codes — admin-only table, no legit client writes
-- ============================================
-- /api/invite/create uses the service-role client and is the
-- legitimate creation path.

REVOKE INSERT, UPDATE ON invite_codes FROM anon, authenticated;

-- ============================================
-- 5. Restore handle_new_user() trigger for signup
-- ============================================
-- The Clerk migration (20251219120000) dropped this. Restoring it
-- with user_id::TEXT cast since learners.user_id is now TEXT.
-- SECURITY DEFINER means the function runs as its owner (postgres),
-- which bypasses the REVOKE INSERT above and lets signup work.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.learners (user_id, display_name, verified_emails)
  VALUES (
    NEW.id::text,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN NEW.email IS NULL OR NEW.email = '' THEN '{}'::text[] ELSE ARRAY[lower(NEW.email)] END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

COMMENT ON FUNCTION handle_new_user() IS
  'Creates learners row when a new auth.users row is inserted. SECURITY DEFINER bypasses the REVOKE INSERT on learners that blocks the role-escalation exploit. Restored 2026-05-21 (dropped by Clerk migration 20251219120000 — Clerk never shipped).';

NOTIFY pgrst, 'reload schema';

COMMIT;
