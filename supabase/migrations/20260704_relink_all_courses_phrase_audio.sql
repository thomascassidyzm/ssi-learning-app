-- Relink practice-phrase audio pointers across ALL courses (data-only, idempotent).
--
-- Generalises 20260704_relink_zho_for_eng_phrase_audio.sql to every course.
-- Sweep measurement (2026-07-04): beyond zho_for_eng, ~3.2k USE rows still
-- carried NULL pointers despite a matching clip existing in course_audio —
-- jpn_for_eng 2,220, deu 286, kor 266, ara 239, eus 95, ita 84, plus small
-- eng_for_X tails. Same LINK gap, not audio gap: relink first, never
-- regenerate. Rows whose text has no clip (unbuilt seed-300→668 extensions,
-- Stage-0/WIP courses: mar/tel/gla/mlt/bre/deu_at/por_for_jpn/eng_for_kan…)
-- are untouched — those need the content pipeline, not a pointer.
--
-- MATCHING (canonical, per services/shared/text-normalize.cjs): lowercase,
-- trim, collapse whitespace, strip trailing .!。！ (keep trailing ?) —
-- recomputed from raw text on BOTH sides. Restricted per (course, role) to
-- the course's DOMINANT voice (modal voice_id in course_audio), so relinked
-- rows stay voice- and baked-speed-consistent with each course's existing
-- clips; fringe/legacy voices never get linked. Ties resolve to the newest
-- clip. Fills NULL pointers only — never overwrites a live link, so
-- re-running is a no-op.

BEGIN;

-- Dominant voice per (course, role) — the voice the course actually speaks in.
CREATE TEMP TABLE _dominant_voice ON COMMIT DROP AS
SELECT DISTINCT ON (course_code, role) course_code, role, voice_id
FROM (
  SELECT course_code, role, voice_id, count(*) AS n
  FROM course_audio
  WHERE role IN ('known', 'target1', 'target2')
  GROUP BY course_code, role, voice_id
) t
ORDER BY course_code, role, n DESC;

-- Normalized text → newest clip, dominant voice only. One pass over course_audio.
CREATE TEMP TABLE _audio_norm ON COMMIT DROP AS
SELECT DISTINCT ON (a.course_code, a.role, norm)
       a.course_code, a.role,
       lower(regexp_replace(btrim(regexp_replace(a.text, '\s+', ' ', 'g')), '[.!。！]+$', '')) AS norm,
       a.id, a.duration_ms
FROM course_audio a
JOIN _dominant_voice d
  ON d.course_code = a.course_code AND d.role = a.role AND d.voice_id = a.voice_id
WHERE a.role IN ('known', 'target1', 'target2')
ORDER BY a.course_code, a.role,
         lower(regexp_replace(btrim(regexp_replace(a.text, '\s+', ' ', 'g')), '[.!。！]+$', '')),
         a.created_at DESC;

CREATE INDEX ON _audio_norm (course_code, role, norm);

UPDATE course_practice_phrases p
SET target1_audio_id = a.id,
    target1_duration_ms = COALESCE(p.target1_duration_ms, a.duration_ms)
FROM _audio_norm a
WHERE p.target1_audio_id IS NULL
  AND a.course_code = p.course_code
  AND a.role = 'target1'
  AND a.norm = lower(regexp_replace(btrim(regexp_replace(p.target_text, '\s+', ' ', 'g')), '[.!。！]+$', ''));

UPDATE course_practice_phrases p
SET target2_audio_id = a.id,
    target2_duration_ms = COALESCE(p.target2_duration_ms, a.duration_ms)
FROM _audio_norm a
WHERE p.target2_audio_id IS NULL
  AND a.course_code = p.course_code
  AND a.role = 'target2'
  AND a.norm = lower(regexp_replace(btrim(regexp_replace(p.target_text, '\s+', ' ', 'g')), '[.!。！]+$', ''));

UPDATE course_practice_phrases p
SET known_audio_id = a.id
FROM _audio_norm a
WHERE p.known_audio_id IS NULL
  AND a.course_code = p.course_code
  AND a.role = 'known'
  AND a.norm = lower(regexp_replace(btrim(regexp_replace(p.known_text, '\s+', ' ', 'g')), '[.!。！]+$', ''));

COMMIT;
