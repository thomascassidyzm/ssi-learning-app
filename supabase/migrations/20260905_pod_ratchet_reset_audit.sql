-- 20260905_pod_ratchet_reset_audit
--
-- APPLIED LIVE 2026-09-05 (job #657), canaried in a transaction before commit.
--
-- WHY
-- ---
-- On 2026-09-05 eight learner-courses were found sitting at
-- `course_enrollments.completed_pod_rounds = 0` while their own telemetry
-- proved completed listening-pod laps — a course reset had silently zeroed the
-- intake ratchet. Nothing recorded that. The class could only be INFERRED from
-- a fingerprint (ratchet 0 alongside pod lap events), which is evidence and not
-- proof: job #656 could restore Beuno because his three laps were unambiguous,
-- and could not close the question for anyone else. `updated_at` did not help
-- either — #649's work-debt seeding touched all 1,464 enrollments that morning
-- and overwrote every timestamp that might have dated the zeroing.
--
-- WHAT AND WHY THIS SHAPE
-- -----------------------
-- TWO writers zero this column, and a fix at the call sites would have to catch
-- both and stay caught:
--   * api/account/reset-progress.ts — the Settings reset, SERVICE role
--   * packages/player-vue/src/composables/usePodLapScheduler.ts reset() —
--     PostgREST, AUTHENTICATED role
-- A database trigger catches both, catches the third writer somebody adds next
-- month, needs no client change and no deploy to take effect. Same shape as
-- 20260831_course_enrollments_cursor_trail, for the same reason.
--
-- SECURITY DEFINER is deliberate (RLS doctrine rule 5): the table is
-- service-role-only, and the client reset runs as `authenticated`, which has no
-- INSERT right on it. Without DEFINER the trigger would throw and turn a
-- learner's "reset my course" — a Settings button on a live write path — into a
-- 500. search_path is pinned so the function cannot be redirected. The INSERT is
-- additionally wrapped so that ANY failure inside the audit write is swallowed:
-- an audit trail must never be able to break the thing it audits.
--
-- ADDITIVE AND BEHAVIOUR-FREE. No backfill — historical resets are gone and
-- reconstructing them would be invention. Nothing reads this table yet.

CREATE TABLE IF NOT EXISTS public.pod_ratchet_reset_audit (
  id                       bigserial PRIMARY KEY,
  learner_id               uuid        NOT NULL,
  course_id                text        NOT NULL,
  previous_completed_pod_rounds integer NOT NULL,
  previous_rounds_since_pod integer,
  previous_highest_completed_lego_id text,
  db_role                  text        NOT NULL,
  occurred_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pod_ratchet_reset_audit IS
  'Audit trail for listening-pod ratchet resets: one row each time '
  'course_enrollments.completed_pod_rounds falls from a positive value to zero. '
  'Service-role-only (RLS on, no policies) — written only by the '
  'log_pod_ratchet_reset trigger, never by application code. Exists because '
  'that class of event was previously invisible and could only be inferred '
  'from a fingerprint (job #657, 2026-09-05).';

CREATE INDEX IF NOT EXISTS pod_ratchet_reset_audit_learner_course_idx
  ON public.pod_ratchet_reset_audit (learner_id, course_id, occurred_at DESC);

ALTER TABLE public.pod_ratchet_reset_audit ENABLE ROW LEVEL SECURITY;
-- Explicit posture at creation, never Supabase's grant-open default: no
-- policies at all, so anon/authenticated cannot read or write it by any path.
REVOKE ALL ON TABLE public.pod_ratchet_reset_audit FROM anon, authenticated;
GRANT ALL ON TABLE public.pod_ratchet_reset_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pod_ratchet_reset_audit_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.log_pod_ratchet_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.pod_ratchet_reset_audit (
      learner_id, course_id, previous_completed_pod_rounds,
      previous_rounds_since_pod, previous_highest_completed_lego_id, db_role
    ) VALUES (
      OLD.learner_id, OLD.course_id, OLD.completed_pod_rounds,
      OLD.rounds_since_pod, OLD.highest_completed_lego_id, current_user
    );
  EXCEPTION WHEN OTHERS THEN
    -- The audit must never break the reset it is auditing.
    RAISE WARNING 'log_pod_ratchet_reset failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_pod_ratchet_reset ON public.course_enrollments;
CREATE TRIGGER trg_log_pod_ratchet_reset
  AFTER UPDATE OF completed_pod_rounds ON public.course_enrollments
  FOR EACH ROW
  WHEN (coalesce(OLD.completed_pod_rounds, 0) > 0
        AND coalesce(NEW.completed_pod_rounds, 0) = 0)
  EXECUTE FUNCTION public.log_pod_ratchet_reset();

NOTIFY pgrst, 'reload schema';
