-- live_session_count(p_user_id) — how many sessions does this account hold
-- right now? Read by api/email/verify.ts at the moment a mailbox is proved,
-- so the proving device can be told about a second one (Tom's ruling 3,
-- job #195, 2026-09-18: shown, not killed, default keep). Nothing else
-- reads it and nothing acts on it without a tap.
--
-- SECURITY DEFINER because auth.sessions is not readable through PostgREST;
-- search_path pinned (SEC25-D-01); executable by the service role only —
-- the count of a person's sessions is theirs and the server's, not the
-- browser's. Same shape as cs_session_guard() (job #371).
--
-- "Live" = not past not_after, and touched in the last 30 days. GoTrue can
-- leave a session row behind after its refresh token has died; without the
-- recency bound a teacher with one real device and one dead row would be
-- shown the line, which is the exact thing ruling 3 says the common teacher
-- must never meet.
CREATE OR REPLACE FUNCTION public.live_session_count(p_user_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
  SELECT count(*)::integer
  FROM auth.sessions s
  WHERE s.user_id = p_user_id
    AND (s.not_after IS NULL OR s.not_after > now())
    AND COALESCE(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '30 days';
$$;

COMMENT ON FUNCTION public.live_session_count(uuid) IS 'Sessions this account holds right now (not expired, touched within 30 days). Read by api/email/verify.ts at mailbox proof so a second device can be shown, never killed. Service role only. job #195.';

REVOKE ALL ON FUNCTION public.live_session_count(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.live_session_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_session_count(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
