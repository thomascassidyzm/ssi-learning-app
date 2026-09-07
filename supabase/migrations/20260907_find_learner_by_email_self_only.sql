-- find_learner_by_email was an email oracle. Close it.
--
-- THE DEFECT (live, found 2026-09-07 by the job #301 branch census):
-- public.find_learner_by_email(text) is SECURITY DEFINER, owned by postgres,
-- and GRANTed EXECUTE to `authenticated`. It matched a CLIENT-SUPPLIED email
-- against learners.verified_emails and returned that learner's row —
-- id, auth user_id, display_name, platform_role, educational_role, preferences,
-- created_at, updated_at — bypassing RLS entirely. Any signed-in learner who
-- knew or guessed an email address could resolve the person behind it.
--
-- THE FIX: the identity acted on comes from the caller's own token, never from
-- the parameter. The gate is deliberately IDENTICAL to claim_learner's — the
-- only caller (packages/player-vue/src/composables/useAuth.ts, the "my email is
-- already on an older learner row, link me to it" path) passes its own
-- supabaseUser.email and then immediately calls claim_learner on the result.
-- So the function now answers exactly one question: "which learner am I
-- entitled to claim?" A lookup for anyone else's address returns zero rows,
-- which is the same shape the caller already handles when no learner matches.
--
-- The signature is preserved on purpose: deployed browsers and cached PWA
-- clients keep calling the two-argument RPC with their own address and keep
-- working. The parameter is not ignored — it must equal the caller's own
-- verified token email, so a stale client cannot be talked into anything.
--
-- Matching is now case-insensitive on both sides (it was case-sensitive on the
-- array); that is a superset for the legitimate self-lookup and still bounded
-- to the caller's own address.
--
-- A caller with no JWT (service_role, migrations) gets zero rows. Nothing in
-- api/ calls this function; the grant to service_role is left in place.

CREATE OR REPLACE FUNCTION public.find_learner_by_email(lookup_email text)
RETURNS TABLE(id uuid, user_id text, display_name text, platform_role text,
              educational_role text, preferences jsonb,
              created_at timestamp with time zone,
              updated_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT l.id, l.user_id, l.display_name,
         l.platform_role, l.educational_role, l.preferences,
         l.created_at, l.updated_at
  FROM public.learners l
  WHERE auth.uid() IS NOT NULL
    AND nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') IS NOT NULL
    -- the parameter may only ever be the caller's OWN token email
    AND lower(trim(lookup_email)) = lower(coalesce(auth.jwt() ->> 'email', ''))
    -- and that address must be verified on the learner row being returned
    AND lower(trim(lookup_email)) IN (
          SELECT lower(e)
          FROM unnest(coalesce(l.verified_emails, ARRAY[]::text[])) e)
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.find_learner_by_email(text) IS
  'Self-lookup only. Returns the learner row carrying the CALLER''S OWN verified token email, so a fresh auth user can be linked to an existing learner. The parameter must equal auth.jwt()->>''email''; any other address returns zero rows. Same gate as claim_learner. Was an email oracle until 2026-09-07.';

NOTIFY pgrst, 'reload schema';
