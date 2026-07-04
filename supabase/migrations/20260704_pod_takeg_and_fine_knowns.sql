-- Take G + fine-known audio layer for the unified pod ladder (2026-07-04).
--
-- The ladder plays every sub-sentence chunk as an ms SLICE of one gapped
-- per-sentence render (Take G), and every chunk's English from text-keyed
-- clips — so the schema carries two draft jsonb/array columns on the pod
-- sentences plus two new course_audio roles. Applied to live 2026-07-04
-- (dashboard tools: author-window-knowns / render-fine-knowns / render-take-g
-- / slice-take-g in ssi-dashboard-v7-clean); this file is the drop-in record.

-- Authored English for every fusion window (contiguous fine-unit span),
-- sibling of atom_map_fine: [{g, start, end, known}] with flat unit indices.
-- Regenerated whenever seams change; spans that stop matching are re-authored.
ALTER TABLE public.listening_pod_sentences
    ADD COLUMN IF NOT EXISTS window_known_map jsonb;

-- Take G renders, one per multi-unit GLUED sentence group (leading
-- interjections glue forward), aligned by index; null element = single-unit
-- group (its unit IS the real sentence take). Unit ms spans
-- (atom_map_fine[].target_start_ms/target_end_ms) index into these clips.
ALTER TABLE public.listening_pod_sentences
    ADD COLUMN IF NOT EXISTS takeg_audio_ids uuid[];

-- course_audio roles: pod_fine_known (plain per-unit gloss / per-window
-- translation clips, coach voice, text-keyed) and pod_take_g (the gapped
-- sentence takes, cast voices).
ALTER TABLE public.course_audio DROP CONSTRAINT IF EXISTS course_audio_role_check;
ALTER TABLE public.course_audio ADD CONSTRAINT course_audio_role_check
    CHECK (role = ANY (ARRAY['known'::text, 'target1'::text, 'target2'::text,
        'presentation'::text, 'welcome'::text, 'encouragement'::text,
        'instruction'::text, 'bookend_listen_intro'::text,
        'bookend_listen_outro'::text, 'pod_explainer'::text,
        'pod_fine_known'::text, 'pod_take_g'::text]));
