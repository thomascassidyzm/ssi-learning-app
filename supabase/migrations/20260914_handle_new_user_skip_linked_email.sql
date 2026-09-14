-- 20260914_handle_new_user_skip_linked_email.sql
--
-- ██ GATED — PARKED, NOT APPLIED. ██  dev/staging/prod share ONE database; a
-- trigger on auth.users fires for every sign-up on every environment, so this
-- goes in deliberately via the canary method (supabase/secfix-toolkit/), not
-- with a branch merge. Sibling of the 20260903 gated migration.
--
-- Why. handle_new_user() inserts a learners row for EVERY new auth.users row,
-- carrying verified_emails=[that address]. Sign-in codes are minted with
-- generateLink (api/auth/send-code.ts), which creates the auth user for an
-- address nobody has seen — so the moment a person types a second address to
-- LINK it, a stub learner already holds it. Two things then break:
--   1. api/email/verify.ts saw the stub as "another account" and refused
--      every fresh link (job #646 fixed that route to absorb a data-less stub);
--   2. signing IN with a linked address never reaches useAuth.ts's
--      find_learner_by_email → claim_learner path, because step 1 (learner by
--      auth uid) always finds the stub first. The person lands on an empty
--      account instead of their own — the recoverability the linked-email
--      feature exists for does not actually work while this trigger creates
--      stubs unconditionally.
-- What. When another learner already holds lower(NEW.email) in
-- verified_emails, create no stub: the client's link path then claims the
-- existing learner exactly as designed. Everything else is unchanged.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' AND EXISTS (
    SELECT 1 FROM public.learners l
    WHERE lower(NEW.email) = ANY (coalesce(l.verified_emails, ARRAY[]::text[]))
  ) THEN
    -- Address already verified on a learner: this auth user is a second door
    -- into that learner, claimed by the client on first sign-in. No stub.
    RETURN NEW;
  END IF;

  INSERT INTO public.learners (user_id, display_name, verified_emails)
  VALUES (
    NEW.id::text,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN NEW.email IS NULL OR NEW.email = '' THEN '{}'::text[] ELSE ARRAY[lower(NEW.email)] END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;
