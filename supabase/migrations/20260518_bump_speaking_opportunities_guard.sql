-- Defence-in-depth: guard bump_speaking_opportunities against cross-learner writes.
--
-- Why: the function takes p_learner_id as a parameter and runs SECURITY INVOKER.
-- Today, RLS on learner_speaking_opportunities blocks INSERT/UPDATE against
-- another learner's row, so the IDOR is closed. But if any future caller uses
-- service-role (which bypasses RLS) to invoke this RPC, the parameter becomes
-- an unrestricted IDOR. The in-body check makes the function safe regardless
-- of how it's called.
--
-- search_path pin is the standard hardening for the same reason as the role-check
-- functions — even though this is SECURITY INVOKER, pinning is cheap and removes
-- one class of surprise.
--
-- Signature unchanged from 20260514_learner_speaking_opportunities.sql.

CREATE OR REPLACE FUNCTION bump_speaking_opportunities(
  p_learner_id   uuid,
  p_course_code  text,
  p_opps_delta   bigint DEFAULT 0,
  p_seconds_delta bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM learners
    WHERE id = p_learner_id
      AND user_id = auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'unauthorized: learner_id does not belong to caller'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO learner_speaking_opportunities AS lso
    (learner_id, course_code, day, opportunities, play_seconds)
  VALUES
    (p_learner_id, p_course_code, (now() AT TIME ZONE 'UTC')::date,
     GREATEST(p_opps_delta, 0), GREATEST(p_seconds_delta, 0))
  ON CONFLICT (learner_id, course_code, day) DO UPDATE
    SET
      opportunities = lso.opportunities + GREATEST(p_opps_delta, 0),
      play_seconds  = lso.play_seconds  + GREATEST(p_seconds_delta, 0),
      updated_at    = now();
END;
$$;

NOTIFY pgrst, 'reload schema';
