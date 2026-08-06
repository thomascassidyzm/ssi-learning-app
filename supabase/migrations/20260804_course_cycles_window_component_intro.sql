-- 20260804_course_cycles_window_component_intro
--
-- Project `presentation_audio_id` and `introduce` in the phrase payload of
-- get_course_cycles_window, so /api/courses/:code/cycles can emit
-- `component_intro` cycles.
--
-- WHY
-- ---
-- Component rows (course_practice_phrases.phrase_role = 'component') carry
-- their own "as in" narration — the clip that contextualises one piece of an
-- M-LEGO inside the parent phrase:
--
--   "The Italian for: 'to practise', as in — 'to practise speaking', is:"
--
-- The player has known how to render `component_intro` cycles since the
-- cutover (toSimpleRounds, validateLearningScript, scriptItemToCycle,
-- LearningPlayer), but the backend never emitted them, because this function
-- did not return the two columns needed to assemble one. Measured 2026-08-04:
-- 1189 playable component intros exist for ita_for_eng and 1105 for
-- spa_for_eng — authored, rendered, and never once heard by a learner.
--
-- SHAPE OF THE CHANGE
-- -------------------
-- Purely ADDITIVE: two extra keys inside each element of the `phrases` array.
-- Callers that don't read them are unaffected, so this is safe to apply ahead
-- of the deploy that consumes it (dev/staging/prod share one DB).
--
-- Nothing else in the function body changes.

CREATE OR REPLACE FUNCTION public.get_course_cycles_window(
  p_course_code text,
  p_from_lego_id text,
  p_round_limit integer
)
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
      l.is_new,
      l.known_audio_id, l.target1_audio_id, l.target2_audio_id, l.presentation_audio_id,
      l.target1_duration_ms, l.target2_duration_ms
    FROM course_legos l
    JOIN rounds r ON r.lego_id = l.lego_id
    WHERE l.course_code = p_course_code
  ),
  phrases AS (
    SELECT
      p.seed_number, p.lego_index, p.position, p.phrase_role,
      p.known_text, p.target_text, p.target_text_roman,
      p.decomposition,
      p.display_tiling,
      p.known_audio_id, p.target1_audio_id, p.target2_audio_id,
      -- NEW: the component "as in" narration + its introduce flag.
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

NOTIFY pgrst, 'reload schema';
