-- Restore player_events authenticated grants (prod incident, 2026-07-17).
--
-- An overnight agent applying the grant-hygiene doctrine (see
-- 20260704_grant_hygiene_org_tables.sql) to the wrong table ran an
-- out-of-band REVOKE directly via psql (not a migration) against
-- public.player_events. player_events is Supabase's default-open grant
-- surface — every signed-in learner's answer flushes through
-- api/player-events.ts, and while that endpoint writes with the service
-- role (unaffected by the revoke), useAdminUserDetail.ts reads it directly
-- with the caller's own authenticated session for per-user diagnosis — so
-- the revoke silently 403d that admin read path. SELECT+INSERT were
-- manually re-granted live this morning to stop the bleeding; this
-- migration makes that live fix durable and reproducible instead of an
-- undocumented psql command.
--
-- No anon grant: every guest-session write also flows through the
-- service-role endpoint above, so anon never needs direct table access.

GRANT SELECT, INSERT ON public.player_events TO authenticated;

NOTIFY pgrst, 'reload schema';
