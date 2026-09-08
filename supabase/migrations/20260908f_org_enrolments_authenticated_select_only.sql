-- ORG ENROLMENT: make the posture the previous migration DESCRIBES the posture it HAS
-- ====================================================================================
--
-- 20260908e says, in its own words: "own-row SELECT for the learner so they can
-- see their own free-year end date, and NOTHING else". It revoked ALL from anon
-- and granted SELECT to authenticated — but it never revoked from authenticated,
-- so Supabase's grant-open default for new tables survived underneath, leaving
-- authenticated holding INSERT, UPDATE, DELETE and TRUNCATE on org_enrolments.
--
-- Three of those four are already dead: RLS is on and there is no INSERT, UPDATE
-- or DELETE policy, so row-level security refuses them regardless of the grant.
--
-- TRUNCATE is the one that matters. TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY.
-- A grant of TRUNCATE to authenticated is a grant to empty the table, and no
-- policy stands in its way. PostgREST does not issue TRUNCATE, so nothing today
-- can reach it — this is closed as posture, not as an incident.
--
-- RLS doctrine rule 7: every table gets an explicit posture at creation, never
-- Supabase's grant-open default. This is that rule, applied a few minutes late.
--
-- Applied to the live database with both tables still empty and no sign-up link
-- in existence, so nothing learner-facing changes.

BEGIN;

REVOKE ALL ON TABLE public.org_enrolments FROM authenticated;
GRANT SELECT ON TABLE public.org_enrolments TO authenticated;

-- Belt and braces on the policies table: 20260908e revoked it from both roles,
-- but state it again so the two tables read the same way.
REVOKE ALL ON TABLE public.org_enrolment_policies FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
