-- SESSION GUARD AT THE POSTGREST LAYER (job #371, Astra claim 2, confirmed live 2026-09-08).
--
-- THE HOLE. api/auth/claim-account.ts revokes a squatted account by a GLOBAL sign-out, and
-- GoTrue honours it at once: getUser(token) answers "Auth session missing". PostgREST does
-- not ask GoTrue. It checks the JWT's signature and expiry locally, so the revoked access
-- token keeps reading rows for the rest of its life — 3600 seconds on this project, measured
-- 2026-09-08 ("before signout: 200 / global signout / GoTrue: DEAD / after signout: 200").
--
-- THE CLOSE. PostgREST runs one function before every request when the authenticator role
-- carries `pgrst.db_pre_request`. This one reads the token's `session_id` claim and refuses the
-- request when no such session exists any more in auth.sessions — which is exactly the state a
-- global sign-out leaves behind. Tokens with no session_id (service_role, anon) pass untouched.
--
-- FAIL OPEN, BY CONSTRUCTION. The only refusal is a definitive "that session row is gone". Any
-- other error inside the guard — a schema change under it, a permissions slip — returns and
-- lets the request through, because a guard that can take the whole API down is a worse fault
-- than the hour it closes. PT401 is the PostgREST convention: sqlstate PTnnn maps to HTTP nnn.
--
-- COST. One primary-key lookup on auth.sessions per request. On this database that is
-- sub-millisecond against a table of ~1,700 rows.
--
-- HOW IT SHIPS. Not by this file being run blind. supabase/secfix-toolkit/canary_session_guard.cjs
-- proves the function in a ROLLED-BACK transaction against the live database first (as the
-- authenticated role, with a live session id, a dead one and none), then applies it, reloads
-- PostgREST, re-runs the live probe tools/security/revoked-token-postgrest-probe.mjs, and
-- rolls back on any red. Reversal is the two lines at the bottom of this file.

BEGIN;

CREATE OR REPLACE FUNCTION public.cs_session_guard() RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  sid text;
  alive boolean;
BEGIN
  sid := current_setting('request.jwt.claims', true)::json->>'session_id';
  IF sid IS NULL OR sid = '' THEN
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = sid::uuid) INTO alive;
  IF NOT alive THEN
    RAISE SQLSTATE 'PT401' USING
      message = 'Session revoked',
      detail = 'This access token belongs to a session that has been signed out.';
  END IF;
EXCEPTION
  WHEN SQLSTATE 'PT401' THEN
    RAISE;
  WHEN OTHERS THEN
    -- fail open: the guard must never be the reason the API is down
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.cs_session_guard() IS
  'PostgREST pre-request guard: refuses an access token whose session_id no longer exists in auth.sessions (global sign-out). Fails open on any other error. job #371.';

REVOKE ALL ON FUNCTION public.cs_session_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cs_session_guard() TO anon, authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.cs_session_guard';

COMMIT;

NOTIFY pgrst, 'reload config';

-- ROLLBACK (the whole of it):
--   ALTER ROLE authenticator RESET pgrst.db_pre_request;  NOTIFY pgrst, 'reload config';
--   DROP FUNCTION IF EXISTS public.cs_session_guard();
