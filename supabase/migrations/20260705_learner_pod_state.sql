-- learner_pod_state — the shared per-sentence pod maturity counter
-- (the "two doors, one counter" bridge, Tom 2026-07-05).
--
-- Both pod doors read AND advance it:
--   • MAIN FLOW (usePodLapScheduler): a sentence's stage maths use
--     effective = max(derived alive, exposures); each completed lap writes
--     back exposures = effective + 1 for every sentence that rode it.
--   • LISTENING MODE Dialogues>Drill: a sentence's fusion rung = exposures
--     (rung 0 = first exposure); a completed drill pass writes exposures + 1
--     for each drilled sentence, at most once per sitting.
--
-- `exposures` = exposures COMPLETED (0-based). The derived main-flow value
-- (completed_pod_rounds − ordinal + 1) stays as the inheritance floor, so
-- existing learners cut over with identical behaviour and a lost row can
-- never send anyone backwards (forward-only by construction: writers only
-- ever store max(current effective) + 1).
--
-- sentence_id = listening_pod_sentences.id for whole-turn rows, or
-- `${row.id}:s${index}` for June-split per-sentence units — the same id
-- convention both doors already use client-side.
--
-- Modeled on learner_l1_state (same key shape, RLS, trigger, grants).

CREATE TABLE IF NOT EXISTS public.learner_pod_state (
    learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    course_code text NOT NULL,
    sentence_id text NOT NULL,
    exposures integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (learner_id, course_code, sentence_id)
);

COMMENT ON TABLE public.learner_pod_state IS
  'Per-learner per-pod-sentence exposure counter shared by BOTH pod doors (main-flow pod laps + Listening Mode Drill). exposures = completed exposures; main flow serves view exposures+1, drill serves fusion rung = exposures. Forward-only; derived main-flow alive remains the inheritance floor.';
COMMENT ON COLUMN public.learner_pod_state.sentence_id IS
  'listening_pod_sentences.id, or `${id}:s${index}` for a June-split per-sentence unit — the client-side per-sentence id convention.';

CREATE INDEX IF NOT EXISTS idx_learner_pod_state_learner_course
  ON public.learner_pod_state USING btree (learner_id, course_code);

CREATE TRIGGER update_learner_pod_state_updated_at
  BEFORE UPDATE ON public.learner_pod_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.learner_pod_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pod state" ON public.learner_pod_state
  FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));

CREATE POLICY "Users can insert own pod state" ON public.learner_pod_state
  FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));

CREATE POLICY "Users can update own pod state" ON public.learner_pod_state
  FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));

CREATE POLICY "Users can delete own pod state" ON public.learner_pod_state
  FOR DELETE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));

CREATE POLICY "Admins can read all learner_pod_state" ON public.learner_pod_state
  FOR SELECT TO authenticated USING (public.is_ssi_admin());

GRANT ALL ON TABLE public.learner_pod_state TO anon;
GRANT ALL ON TABLE public.learner_pod_state TO authenticated;
GRANT ALL ON TABLE public.learner_pod_state TO service_role;

NOTIFY pgrst, 'reload schema';
