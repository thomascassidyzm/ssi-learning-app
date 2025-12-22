-- Migration: Update practice_cycles view to include target_syllable_count
-- Date: 2025-12-21
-- Purpose: Enable eternal phrase selection by syllable count (language-agnostic)

-- The practice_cycles view joins course_practice_phrases with lego_cycles
-- lego_cycles has the audio columns (known_audio_uuid, target1_audio_uuid, etc.)

DROP VIEW IF EXISTS practice_cycles;

CREATE VIEW practice_cycles AS
SELECT
  cpp.id,
  cpp.course_code,
  cpp.seed_number,
  cpp.lego_index,
  lc.lego_id,
  cpp.position,
  CASE
    WHEN cpp.position = 0 THEN 'component'
    WHEN cpp.position = 1 THEN 'debut'
    ELSE 'practice'
  END as phrase_type,
  cpp.word_count,
  cpp.lego_count,
  cpp.difficulty,
  cpp.register,
  cpp.status,
  cpp.version,
  cpp.known_text,
  cpp.target_text,
  cpp.target_syllable_count,  -- NEW: For eternal phrase selection
  lc.known_audio_uuid,
  lc.known_duration_ms,
  lc.target1_audio_uuid,
  lc.target1_duration_ms,
  lc.target2_audio_uuid,
  lc.target2_duration_ms
FROM course_practice_phrases cpp
JOIN lego_cycles lc
  ON cpp.seed_number = lc.seed_number
  AND cpp.lego_index = lc.lego_index
  AND cpp.course_code = lc.course_code;
