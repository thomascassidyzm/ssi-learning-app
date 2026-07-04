-- Relink zho_for_eng practice-phrase audio pointers (data-only, idempotent).
--
-- WHY: Listening mode's ALL tab (and the main flow's USE cycles) read
-- known/target1/target2_audio_id straight off course_practice_phrases.
-- For zho_for_eng only 891 of 6,835 USE rows carried a target1 id — the
-- recent phrase sweeps bumped rows without re-pointing them — so the ALL
-- tab auto-advanced through thousands of silent rows ("spinning wheels").
-- The clips themselves already exist in course_audio (6,918 target1 rows):
-- this is a LINK gap, not an audio gap. Relink first, never regenerate.
--
-- MATCHING: canonical audio normalizer on BOTH sides, recomputed from raw
-- text (services/shared/text-normalize.cjs: lowercase, trim, collapse
-- whitespace, strip trailing .!。！ — trailing ? kept). Restricted to the
-- course's dominant voice per role (all 891 pre-linked USE rows point at
-- azure_zh-CN-XiaoxiaoMultilingualNeural), so relinked rows are voice- and
-- baked-speed-consistent with existing playback. Ties (same text voiced
-- more than once) resolve to the newest clip.
--
-- SCOPE: fills NULL pointers only — never overwrites a live link, so
-- re-running is a no-op. Rows whose text has no clip in the dominant
-- voice (mostly the unbuilt seed-300→668 extension) stay NULL; the app
-- now filters those out of the ALL tab instead of spinning on them.

-- target1 ─ Xiaoxiao
WITH audio AS (
  SELECT DISTINCT ON (norm) norm, id, duration_ms
  FROM (
    SELECT id, duration_ms, created_at,
           lower(regexp_replace(btrim(regexp_replace(text, '\s+', ' ', 'g')), '[.!。！]+$', '')) AS norm
    FROM course_audio
    WHERE course_code = 'zho_for_eng'
      AND role = 'target1'
      AND voice_id = 'azure_zh-CN-XiaoxiaoMultilingualNeural'
  ) s
  ORDER BY norm, created_at DESC
)
UPDATE course_practice_phrases p
SET target1_audio_id = a.id,
    target1_duration_ms = COALESCE(p.target1_duration_ms, a.duration_ms)
FROM audio a
WHERE p.course_code = 'zho_for_eng'
  AND p.target1_audio_id IS NULL
  AND a.norm = lower(regexp_replace(btrim(regexp_replace(p.target_text, '\s+', ' ', 'g')), '[.!。！]+$', ''));

-- target2 ─ Yunyi
WITH audio AS (
  SELECT DISTINCT ON (norm) norm, id, duration_ms
  FROM (
    SELECT id, duration_ms, created_at,
           lower(regexp_replace(btrim(regexp_replace(text, '\s+', ' ', 'g')), '[.!。！]+$', '')) AS norm
    FROM course_audio
    WHERE course_code = 'zho_for_eng'
      AND role = 'target2'
      AND voice_id = 'azure_zh-CN-YunyiMultilingualNeural'
  ) s
  ORDER BY norm, created_at DESC
)
UPDATE course_practice_phrases p
SET target2_audio_id = a.id,
    target2_duration_ms = COALESCE(p.target2_duration_ms, a.duration_ms)
FROM audio a
WHERE p.course_code = 'zho_for_eng'
  AND p.target2_audio_id IS NULL
  AND a.norm = lower(regexp_replace(btrim(regexp_replace(p.target_text, '\s+', ' ', 'g')), '[.!。！]+$', ''));

-- known ─ Sonia (English side; matches on known_text)
WITH audio AS (
  SELECT DISTINCT ON (norm) norm, id
  FROM (
    SELECT id, created_at,
           lower(regexp_replace(btrim(regexp_replace(text, '\s+', ' ', 'g')), '[.!。！]+$', '')) AS norm
    FROM course_audio
    WHERE course_code = 'zho_for_eng'
      AND role = 'known'
      AND voice_id = 'azure_en-GB-SoniaNeural'
  ) s
  ORDER BY norm, created_at DESC
)
UPDATE course_practice_phrases p
SET known_audio_id = a.id
FROM audio a
WHERE p.course_code = 'zho_for_eng'
  AND p.known_audio_id IS NULL
  AND a.norm = lower(regexp_replace(btrim(regexp_replace(p.known_text, '\s+', ' ', 'g')), '[.!。！]+$', ''));
