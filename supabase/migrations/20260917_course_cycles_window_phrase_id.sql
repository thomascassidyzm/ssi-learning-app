-- get_course_cycles_window projects the phrase's OWN id (job #128).
--
-- A cycle id has to NAME the phrase it plays: the class brain reads the
-- phrase's role and index straight out of it. The cycles endpoint had no name
-- to stamp — the window's phrase rows carried `position`, which is a per-LEGO
-- ordinal over every role, not the index the phrase id carries. Counting rows
-- to reconstruct that index is wrong wherever a row has since been deleted:
-- 549 of deu_for_eng's 1,816 build/use rows sit past a gap.
--
-- Purely additive: one more column in an existing scan, read-only. Every
-- caller that ignores it is unaffected. Replaced from the LIVE definition
-- (pg_get_functiondef, 2026-09-17), which schema.sql did not match.

CREATE OR REPLACE FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH
  course AS (
    SELECT c.course_code, c.version
    FROM courses c
    WHERE c.course_code = p_course_code
    LIMIT 1
  ),
  start_round AS (
    SELECT r.round_index
    FROM course_round_index r
    WHERE r.course_code = p_course_code
      AND r.lego_id = p_from_lego_id
    LIMIT 1
  ),
  rounds AS (
    SELECT r.round_index, r.lego_id, r.seed_number, r.lego_index
    FROM course_round_index r
    WHERE r.course_code = p_course_code
      AND r.round_index >= (SELECT round_index FROM start_round)
    ORDER BY r.round_index ASC
    LIMIT p_round_limit
  ),
  legos AS (
    SELECT
      l.seed_number, l.lego_index, l.lego_id, l.type,
      l.known_text, l.target_text, l.target_text_roman, l.components,
      -- NEW: the human's per-target-word segmentation of the known gloss.
      l.known_gloss_segments,
      l.is_new,
      l.known_audio_id, l.target1_audio_id, l.target2_audio_id, l.presentation_audio_id,
      l.target1_duration_ms, l.target2_duration_ms
    FROM course_legos l
    JOIN rounds r ON r.lego_id = l.lego_id
    WHERE l.course_code = p_course_code
  ),
  phrases AS (
    SELECT
      -- The phrase's OWN id (`…:S0042L03U05`): the NAME the cycle id carries,
      -- so the class brain can read back which phrase actually played.
      p.id,
      p.seed_number, p.lego_index, p.position, p.phrase_role,
      p.known_text, p.target_text, p.target_text_roman,
      p.decomposition,
      p.display_tiling,
      p.known_audio_id, p.target1_audio_id, p.target2_audio_id,
      p.presentation_audio_id, p.introduce,
      p.target1_duration_ms, p.target2_duration_ms
    FROM course_practice_phrases p
    WHERE p.course_code = p_course_code
      AND (p.seed_number, p.lego_index) IN (SELECT r.seed_number, r.lego_index FROM rounds r)
    ORDER BY p.position ASC NULLS LAST
  )
SELECT jsonb_build_object(
  'course',  (SELECT to_jsonb(c) FROM course c),
  'rounds',  (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.round_index), '[]'::jsonb) FROM rounds r),
  'legos',   (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM legos l),
  'phrases', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.position NULLS LAST), '[]'::jsonb) FROM phrases p)
);
$function$;

COMMENT ON FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer) IS 'Single-roundtrip data source for the instant-playback cycles endpoint. Returns {course, rounds, legos, phrases} as jsonb (phrases carry their own id and display_tiling). Read-only.';

NOTIFY pgrst, 'reload schema';
