-- course_audio_envelope — model-voice volume-envelope metadata (adaptation v2,
-- workstream C, WP-7a: docs/adaptation/adaptation-v2-build-spec.md §5.2).
--
-- Precomputed offline, once per mastered audio file, by the dashboard-repo
-- pipeline job (ssi-dashboard-v7-clean, services/audio-envelope.cjs — WP-7b),
-- using the SAME algorithm/constants (services/shared/envelope-extractor-v1.json,
-- copied verbatim into this repo as packages/core/src/audio/envelope-extractor-v1.json)
-- as the client's own extractor (packages/core/src/audio/envelopeMetadata.ts,
-- WP-6) — so learner and model numbers are directly comparable.
--
-- Read-only content data, same posture as course_audio: RLS on, anon +
-- authenticated SELECT true, writes are service-role only (the pipeline job).
--
-- Gated migration for Tom to apply — never ad-hoc (same rule as WP-4's
-- persistence migration; see CLAUDE.md RLS doctrine).

CREATE TABLE IF NOT EXISTS public.course_audio_envelope (
    audio_id            uuid PRIMARY KEY REFERENCES public.course_audio(id) ON DELETE CASCADE,
    duration_ms         integer NOT NULL,
    peak_count          integer NOT NULL,
    peak_to_mean_ratio  real NOT NULL,
    mean_peak_width_ms  real NOT NULL,
    extractor_version   integer NOT NULL DEFAULT 1,
    created_at          timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.course_audio_envelope IS
  'Model-voice volume-envelope metadata (duration/peak-count/peak-shape), precomputed offline per mastered audio file by the dashboard-repo pipeline job. Compared client-side against the learner''s own live-extracted envelope (adaptation v2 stage 2). extractor_version gates comparability when the pinned constants are retuned.';
COMMENT ON COLUMN public.course_audio_envelope.audio_id IS
  'course_audio.id — the same UUID the player already holds per cycle (target1 audio).';
COMMENT ON COLUMN public.course_audio_envelope.extractor_version IS
  'Must match the client extractor''s ENVELOPE_EXTRACTOR_CONSTANTS.version. A mismatch means the two sides used different constants — the delta producer skips the cycle rather than compare incomparable numbers.';

ALTER TABLE public.course_audio_envelope ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_course_audio_envelope ON public.course_audio_envelope
  FOR SELECT TO anon USING (true);

CREATE POLICY authenticated_read_course_audio_envelope ON public.course_audio_envelope
  FOR SELECT TO authenticated USING (true);

CREATE POLICY course_audio_envelope_service_policy ON public.course_audio_envelope
  TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON TABLE public.course_audio_envelope TO anon;
GRANT SELECT ON TABLE public.course_audio_envelope TO authenticated;
GRANT ALL ON TABLE public.course_audio_envelope TO service_role;

NOTIFY pgrst, 'reload schema';
