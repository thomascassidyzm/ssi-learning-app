-- 20260813_course_cycles_window_gloss_segments
--
-- Project `known_gloss_segments` in the LEGO payload of
-- get_course_cycles_window, so /api/courses/:code/cycles can hand the intro's
-- AUTHORED word mapping to the learner's tile assembler.
--
-- WHY
-- ---
-- Tom, 2026-08-13, on the mapping editor that shipped the day before: "this is
-- the breakdown that feeds into the LEGO TILE ASSEMBLER function, which doesn't
-- seem to be doing the mapping properly as it happens... this is the whole
-- point of the mapping - to show the literal builds in the known language that
-- 'map' to the correct order in the target language."
--
-- The assembler is keyed on COMPONENTISATION and that is not a bug: an M-LEGO
-- with components tiles into them, an A-LEGO with none shows one tile. What was
-- missing is a better source. `course_legos.known_gloss_segments` is the human's
-- own segmentation of the known gloss against the target's word order — the
-- thing the editor exists to produce — and it never reached the player at all,
-- because this function does not return the column. Authoring it changed
-- nothing a learner could see.
--
-- eus_for_eng is the worked case. The M-LEGO `gogoratzen saiatzen ari naiz`
-- declares components `gogoratu` and `nahian ari naiz`, neither of which occurs
-- in its own target text, so claim-matching can never gloss it and the learner
-- gets one block with one natural English sentence underneath. An authored
-- mapping says exactly which known chunk sits under which Basque word.
--
-- SHAPE OF THE CHANGE
-- -------------------
-- Purely ADDITIVE: one extra key inside each element of the `legos` array.
-- Callers that don't read it are unaffected, so this is safe to apply ahead of
-- the deploy that reads it. Nothing else in the function moves.
--
-- Componentisation is NOT removed and NOT bypassed — it stays the fallback
-- wherever no mapping has been authored (Tom: "work with the existing
-- mechanism, not around it or in place of it").

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
