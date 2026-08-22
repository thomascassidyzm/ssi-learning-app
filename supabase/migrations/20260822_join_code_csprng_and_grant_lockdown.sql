-- SEC22-01 — join-code minter: cryptographic randomness + grant lockdown.
--
-- Audit 2026-08-22 (branch security/audit-2026-08-22) found two halves of one
-- finding on public.generate_join_code():
--   (a) it mints from PostgreSQL's non-cryptographic random(), whose output is
--       a deterministic function of per-session PRNG state, so observed codes
--       carry information about neighbouring codes; and
--   (b) EXECUTE is granted to anon (and PUBLIC), so an unauthenticated caller
--       can POST /rest/v1/rpc/generate_join_code and sample that stream at
--       will — verified live against production on 2026-08-22.
--
-- These codes gate elevated educational_role grants (teacher / school_admin /
-- govt_admin) on redemption, so both halves matter. The application-side
-- minter (api/_utils/codeGen.ts) was already hardened to crypto.randomInt in
-- the 2026-08-11 pass; this is the missed database caller. The fix is a port,
-- not a design.
--
-- WHAT THIS CHANGES: only how NEW codes are minted, and who may mint them.
-- The code FORMAT is unchanged (XXX-NNN, same 24-consonant / 10-digit
-- alphabets, same 13.8M keyspace shape). Nothing here touches validation or
-- lookup of existing codes, and no existing code is regenerated or
-- invalidated. Every join code already in classes.student_join_code,
-- schools.teacher_join_code, schools.admin_join_code and invite_codes keeps
-- working exactly as before.
--
-- WHY THE TRIGGER FUNCTIONS BECOME SECURITY DEFINER. generate_join_code() is
-- reached by exactly two BEFORE-INSERT triggers — tr_classes_join_code
-- (set_class_join_code) and tr_schools_join_code (set_school_join_code) — and
-- `authenticated` holds INSERT on public.classes, because a signed-in teacher
-- creates a class straight from the browser
-- (packages/player-vue/src/composables/schools/useClassesData.ts createClass).
-- Both trigger functions were SECURITY INVOKER, so that browser insert would
-- lose the right to mint the moment EXECUTE is revoked from `authenticated`.
-- Marking the two trigger functions SECURITY DEFINER moves the mint back
-- inside the owner's rights, so the legitimate signed-in path is untouched
-- while the directly-callable RPC port closes. Their audit surface is tiny by
-- construction: neither reads or writes any table — each only assigns a
-- generated string onto NEW — and both get a pinned search_path.
--
-- Reversible: supabase/secfix-toolkit/rollback_join_code_csprng.sql restores
-- the previous definitions and grants verbatim.

-- ── (a) mint from pgcrypto's CSPRNG ──────────────────────────────────────────
-- pgcrypto is installed in schema `extensions` on this database, so
-- gen_random_bytes is called schema-qualified rather than relying on
-- search_path. Bytes are drawn with rejection sampling (reject >= 240 for the
-- 24-letter alphabet, >= 250 for the 10-digit one) so the mapping from byte to
-- character is uniform — a bare `byte % 24` would bias the first 16 letters.
CREATE OR REPLACE FUNCTION public.generate_join_code() RETURNS text
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
DECLARE
  letters TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- No I, O (confusable)
  numbers TEXT := '0123456789';
  result TEXT := '';
  i INTEGER;
  b INTEGER;
BEGIN
  -- 3 letters
  FOR i IN 1..3 LOOP
    LOOP
      b := get_byte(extensions.gen_random_bytes(1), 0);
      EXIT WHEN b < 240;  -- 240 = 24 * 10, the largest unbiased cut for %24
    END LOOP;
    result := result || substr(letters, (b % 24) + 1, 1);
  END LOOP;

  result := result || '-';

  -- 3 numbers
  FOR i IN 1..3 LOOP
    LOOP
      b := get_byte(extensions.gen_random_bytes(1), 0);
      EXIT WHEN b < 250;  -- 250 = 25 * 10, the largest unbiased cut for %10
    END LOOP;
    result := result || substr(numbers, (b % 10) + 1, 1);
  END LOOP;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.generate_join_code() IS
  'Mints an XXX-NNN join code from pgcrypto gen_random_bytes with rejection sampling (SEC22-01, 2026-08-22). EXECUTE is service_role only; the class/school triggers reach it as SECURITY DEFINER.';

-- ── keep the two legitimate callers able to mint ─────────────────────────────
ALTER FUNCTION public.set_class_join_code() SECURITY DEFINER;
ALTER FUNCTION public.set_class_join_code() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_school_join_code() SECURITY DEFINER;
ALTER FUNCTION public.set_school_join_code() SET search_path = public, pg_temp;

-- ── (b) close the RPC sampling port ──────────────────────────────────────────
-- A browser never needs to mint a join code: every legitimate mint happens
-- inside an INSERT on classes/schools (trigger, above) or through a
-- service-role server endpoint. Trigger firing does not check EXECUTE on the
-- trigger function, and a trigger function cannot be invoked directly, so the
-- trigger-function revokes below cost the live path nothing — they just take
-- the two helpers off the PostgREST-reachable surface with the minter.
REVOKE ALL ON FUNCTION public.generate_join_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_join_code() FROM anon;
REVOKE ALL ON FUNCTION public.generate_join_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_join_code() TO service_role;

REVOKE ALL ON FUNCTION public.set_class_join_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_class_join_code() FROM anon;
REVOKE ALL ON FUNCTION public.set_class_join_code() FROM authenticated;
REVOKE ALL ON FUNCTION public.set_school_join_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_school_join_code() FROM anon;
REVOKE ALL ON FUNCTION public.set_school_join_code() FROM authenticated;

NOTIFY pgrst, 'reload schema';
