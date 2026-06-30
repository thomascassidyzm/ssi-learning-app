-- Per-learner meta-commentary progress.
--
-- Instructions are a one-time structured sequence ("the story"); their index
-- must persist per LEARNER across courses AND devices, so it lives server-side
-- rather than only in localStorage (which is per-device, so a new phone would
-- replay the whole instruction set). Mirrors the learner_l1_state conventions
-- (own-row RLS keyed on learners.id, admin read, anon/authenticated/service
-- grants). One row per learner; encouragement rotation stays session-local.

CREATE TABLE IF NOT EXISTS public.learner_meta_commentary_state (
    learner_id uuid NOT NULL,
    instructions_complete boolean DEFAULT false NOT NULL,
    instruction_index integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learner_meta_commentary_state_pkey PRIMARY KEY (learner_id),
    CONSTRAINT learner_meta_commentary_state_learner_id_fkey
        FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE
);

ALTER TABLE public.learner_meta_commentary_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meta commentary state" ON public.learner_meta_commentary_state
    FOR SELECT USING ((learner_id IN ( SELECT learners.id FROM public.learners WHERE (learners.user_id = (auth.uid())::text))));
CREATE POLICY "Users can insert own meta commentary state" ON public.learner_meta_commentary_state
    FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id FROM public.learners WHERE (learners.user_id = (auth.uid())::text))));
CREATE POLICY "Users can update own meta commentary state" ON public.learner_meta_commentary_state
    FOR UPDATE USING ((learner_id IN ( SELECT learners.id FROM public.learners WHERE (learners.user_id = (auth.uid())::text))));
CREATE POLICY "Admins can read all meta commentary state" ON public.learner_meta_commentary_state
    FOR SELECT TO authenticated USING (public.is_ssi_admin());

GRANT ALL ON TABLE public.learner_meta_commentary_state TO anon;
GRANT ALL ON TABLE public.learner_meta_commentary_state TO authenticated;
GRANT ALL ON TABLE public.learner_meta_commentary_state TO service_role;

NOTIFY pgrst, 'reload schema';
