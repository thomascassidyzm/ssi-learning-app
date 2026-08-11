-- 20260811_lock_learner_identity_columns.sql
--
-- URGENT security fix. Two live self-escalation paths on public.learners, both
-- confirmed empirically against production on 2026-08-11 (rolled-back canary,
-- role `authenticated` with real JWT claims):
--
--   [1] AUTH-CORE-02 (docs/security-audit-2026-08-11/auth-core.md)
--       `authenticated` holds UPDATE(verified_emails). learners_update_own
--       constrains WHICH row you may write, never the array's CONTENTS, so any
--       learner can plant a third party's address in their own row:
--         UPDATE learners SET verified_emails = ARRAY['victim@ssi.example'] -> 1 row
--       api/access/grant-emails.ts:159-176 resolves allowlist recipients by
--       .contains('verified_emails', ...) and api/_utils/entitlementGrant.ts:78-90
--       writes the grant's grants_platform_role verbatim into learners.platform_role,
--       which api/_utils/auth.ts:114 (verifyAdmin) admits on. api/family/invite.ts:109
--       consumes the same column the same way.
--
--   [2] Found while tracing [1], and strictly worse: `authenticated` holds
--       TABLE-level INSERT on learners, i.e. INSERT on platform_role. Combined
--       with learners_delete_own, one round trip is a full platform-admin takeover
--       with no admin action required:
--         DELETE FROM learners WHERE user_id = auth.uid()::text;             -> 1 row
--         INSERT INTO learners (user_id, display_name, platform_role)
--           VALUES (auth.uid()::text, 'x', 'ssi_admin');                     -> 1 row
--         SELECT is_ssi_admin();                                            -> true
--       api/_utils/admin-entitlement.codes.security.test.ts already guards the
--       UPDATE allowlist against exactly this ("the single most load-bearing grant
--       on the admin surface") -- it just never checked the INSERT side.
--
-- Fix, in three parts. Per RLS doctrine (CLAUDE.md): every REVOKE carries its
-- compensating GRANTs in the same file; RLS stays "is this my row?"; the content
-- rule RLS cannot express lives in one SECURITY DEFINER guard, not in a clever
-- policy.
--
--   A. Narrow write privilege to the columns a browser legitimately writes.
--      INSERT is re-granted per column (the table-level grant had to go first --
--      a column-level REVOKE does not restrict a table-level privilege).
--   B. A BEFORE INSERT OR UPDATE guard on the CONTENT of verified_emails: a
--      client may only ever add an address auth.users / auth.identities already
--      attests belongs to that account. This keeps the INSERT grant (the signup
--      path writes the column, and revoking it would break every browser still
--      running a cached bundle) while making a planted value impossible. It
--      raises rather than silently rewriting -- doctrine 8, convert silent to loud.
--      Service-role writers (api/email/verify.ts's OTP-gated append,
--      api/admin/create-staff.ts) pass through untouched.
--   C. public.sync_my_verified_emails() -- the compensating write path for the one
--      thing the revoked UPDATE was doing: useAuth.ts's best-effort back-fill of
--      the session's own address. Server-side, derives the address from auth.users
--      rather than trusting the caller.
--
-- Canary: supabase/secfix-toolkit/canary_verified_emails_provenance.cjs
-- No BEGIN/COMMIT here by convention -- the canary owns the transaction.

-- -- A. privilege surface ----------------------------------------------------

-- [1] the named finding: no direct client write of the array at all.
REVOKE UPDATE(verified_emails) ON TABLE public.learners FROM authenticated;

-- [2] table-level INSERT -> per-column allowlist. Excluded, deliberately:
--     platform_role, educational_role (verifyAdmin / role resolution),
--     dashboard_courses, is_internal, is_demo (staff + billing flags),
--     invite_code_id, is_class_entity (server-provisioned identity).
--     Every one of those is written only by service-role code
--     (api/code/redeem.ts, api/admin/create-staff.ts, api/_utils/provisionPersona.ts,
--     api/_utils/classLearnerEntity.ts), never by a browser: the only two client
--     inserts are useAuth.ts:346 and views/teach/WithTeacher.vue:211.
REVOKE INSERT ON TABLE public.learners FROM authenticated;
GRANT INSERT (
  id,
  user_id,
  display_name,
  preferences,
  verified_emails,
  needs_verification,
  welcome_played_at,
  created_at,
  updated_at
) ON TABLE public.learners TO authenticated;

-- -- B. content guard on verified_emails --------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_verified_emails_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  old_arr text[] := CASE WHEN TG_OP = 'UPDATE'
                         THEN coalesce(OLD.verified_emails, ARRAY[]::text[])
                         ELSE ARRAY[]::text[] END;
  new_arr text[] := coalesce(NEW.verified_emails, ARRAY[]::text[]);
  attested text[];
  candidate text;
BEGIN
  -- Only browser sessions are policed. PostgREST issues SET LOCAL ROLE per
  -- request, so the `role` GUC is 'authenticated' for anon-key callers,
  -- 'service_role' for server endpoints, and unset/'none' for migrations and
  -- backfills. NOTE: current_user is useless here — this function is SECURITY
  -- DEFINER (it must read auth.users), so inside it current_user is always the
  -- owner. Verified live 2026-08-11: under SET LOCAL ROLE authenticated a
  -- DEFINER function sees current_user=postgres, role GUC=authenticated.
  IF coalesce(current_setting('role', true), 'none') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(DISTINCT lower(e)), ARRAY[]::text[])
    INTO attested
    FROM (
      SELECT u.email AS e
        FROM auth.users u
       WHERE u.id::text = NEW.user_id AND u.email IS NOT NULL
      UNION
      SELECT i.identity_data->>'email'
        FROM auth.identities i
       WHERE i.user_id::text = NEW.user_id
         AND i.identity_data->>'email' IS NOT NULL
    ) s;

  FOREACH candidate IN ARRAY new_arr LOOP
    IF NOT (lower(candidate) = ANY(attested))
       AND NOT (candidate = ANY(old_arr)) THEN
      RAISE EXCEPTION
        'verified_emails: % is not attested for this account - add it through /api/email/verify (OTP)', candidate
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_verified_emails_provenance() IS
  'AUTH-CORE-02 guard: a browser session may only place an address in learners.verified_emails that auth.users/auth.identities already attests for that account, or that was already there (OTP-added via service role). Service-role and owner writes pass through.';

DROP TRIGGER IF EXISTS enforce_verified_emails_provenance ON public.learners;
CREATE TRIGGER enforce_verified_emails_provenance
  BEFORE INSERT OR UPDATE OF verified_emails ON public.learners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_emails_provenance();

-- -- C. compensating write path for the revoked UPDATE -------------------------

CREATE OR REPLACE FUNCTION public.sync_my_verified_emails()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  my_email text;
  result text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sync_my_verified_emails: permission denied (not authenticated)';
  END IF;

  SELECT lower(u.email) INTO my_email
    FROM auth.users u
   WHERE u.id = auth.uid() AND u.email IS NOT NULL;

  -- Link-auth (straight-in) accounts carry a placeholder that never receives
  -- mail -- see packages/player-vue/src/utils/placeholderEmail.ts. It must never
  -- land in verified_emails.
  IF my_email IS NULL OR my_email LIKE '%@invite.saysomethingin.app' THEN
    RETURN coalesce(public.get_my_verified_emails(), ARRAY[]::text[]);
  END IF;

  UPDATE public.learners
     SET verified_emails = coalesce(verified_emails, ARRAY[]::text[]) || my_email
   WHERE user_id = auth.uid()::text
     AND NOT (my_email = ANY(coalesce(verified_emails, ARRAY[]::text[])))
  RETURNING verified_emails INTO result;

  IF result IS NULL THEN
    result := coalesce(public.get_my_verified_emails(), ARRAY[]::text[]);
  END IF;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.sync_my_verified_emails() IS
  'Appends the session''s own auth.users address to its learner row''s verified_emails. Replaces useAuth.ts ensureLearnerExists() direct UPDATE, which was revoked 2026-08-11 (AUTH-CORE-02).';

REVOKE ALL ON FUNCTION public.sync_my_verified_emails() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_my_verified_emails() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_verified_emails() TO service_role;

NOTIFY pgrst, 'reload schema';
