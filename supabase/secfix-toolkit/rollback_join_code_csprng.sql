-- Rollback for 20260822_join_code_csprng_and_grant_lockdown.sql (SEC22-01).
--
-- Restores the pre-2026-08-22 definitions and grants verbatim, as dumped from
-- supabase/schema.sql at commit 0760f15e. Running this re-opens the finding —
-- it exists only so the forward migration is reversible on the live shared DB.
--
-- Note: existing join codes are untouched by BOTH directions. The forward
-- migration and this rollback change only how future codes are minted and who
-- may mint them.

CREATE OR REPLACE FUNCTION public.generate_join_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  letters TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- No I, O (confusable)
  numbers TEXT := '0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  -- 3 letters
  FOR i IN 1..3 LOOP
    result := result || substr(letters, floor(random() * 24 + 1)::int, 1);
  END LOOP;

  result := result || '-';

  -- 3 numbers
  FOR i IN 1..3 LOOP
    result := result || substr(numbers, floor(random() * 10 + 1)::int, 1);
  END LOOP;

  RETURN result;
END;
$$;

ALTER FUNCTION public.generate_join_code() RESET search_path;
COMMENT ON FUNCTION public.generate_join_code() IS NULL;

ALTER FUNCTION public.set_class_join_code() SECURITY INVOKER;
ALTER FUNCTION public.set_class_join_code() RESET search_path;
ALTER FUNCTION public.set_school_join_code() SECURITY INVOKER;
ALTER FUNCTION public.set_school_join_code() RESET search_path;

GRANT ALL ON FUNCTION public.generate_join_code() TO PUBLIC;
GRANT ALL ON FUNCTION public.generate_join_code() TO anon;
GRANT ALL ON FUNCTION public.generate_join_code() TO authenticated;
GRANT ALL ON FUNCTION public.generate_join_code() TO service_role;

GRANT ALL ON FUNCTION public.set_class_join_code() TO PUBLIC;
GRANT ALL ON FUNCTION public.set_class_join_code() TO anon;
GRANT ALL ON FUNCTION public.set_class_join_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_school_join_code() TO PUBLIC;
GRANT ALL ON FUNCTION public.set_school_join_code() TO anon;
GRANT ALL ON FUNCTION public.set_school_join_code() TO authenticated;

NOTIFY pgrst, 'reload schema';
