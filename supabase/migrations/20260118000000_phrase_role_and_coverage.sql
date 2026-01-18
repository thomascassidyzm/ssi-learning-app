-- Migration: Add phrase role and coverage columns to course_practice_phrases
-- Date: 2026-01-18
-- Purpose: Enable explicit phrase categorization and coverage-based selection
--
-- Changes:
--   1. phrase_role: Explicit category instead of deriving from position
--   2. connected_lego_ids: Which other LEGOs appear in this phrase (for coverage)
--   3. lego_position: Where the primary LEGO sits (start/middle/end)
--
-- These columns support:
--   - Debut sequence: Components first, then practice phrases ordered by syllable_count
--   - Eternal/rep selection: Maximize coverage of connections and positions
--   - Future flexibility: Role-based filtering without position overloading

-- ============================================
-- ADD NEW COLUMNS
-- ============================================

-- phrase_role: Explicit categorization
-- - 'component': Parts of M-type LEGOs shown during introduction
-- - 'practice': Build-up phrases used during debut sequence
-- - 'eternal_eligible': Phrases eligible for spaced rep / consolidation
ALTER TABLE course_practice_phrases
ADD COLUMN IF NOT EXISTS phrase_role TEXT NOT NULL DEFAULT 'practice'
  CHECK (phrase_role IN ('component', 'practice', 'eternal_eligible'));

-- connected_lego_ids: Other LEGOs that appear in this phrase
-- Used to ensure variety in eternal/rep selection (don't always pair with same LEGOs)
-- Computed at course creation time from phrase content
ALTER TABLE course_practice_phrases
ADD COLUMN IF NOT EXISTS connected_lego_ids TEXT[] DEFAULT '{}';

-- lego_position: Where the primary LEGO appears in the target phrase
-- Used to ensure variety (don't always show LEGO at start/end)
-- Computed at course creation time from phrase structure
ALTER TABLE course_practice_phrases
ADD COLUMN IF NOT EXISTS lego_position TEXT
  CHECK (lego_position IN ('start', 'middle', 'end'));

-- ============================================
-- INDEXES FOR EFFICIENT QUERYING
-- ============================================

-- Index for filtering by role
CREATE INDEX IF NOT EXISTS idx_practice_phrases_role
ON course_practice_phrases(course_code, seed_number, lego_index, phrase_role);

-- GIN index for array containment queries on connected_lego_ids
-- Enables queries like "find phrases that connect with LEGO X"
CREATE INDEX IF NOT EXISTS idx_practice_phrases_connected_legos
ON course_practice_phrases USING GIN(connected_lego_ids);

-- ============================================
-- BACKFILL EXISTING DATA (Best-effort)
-- ============================================

-- Set phrase_role based on existing position values
-- This preserves current behavior while allowing future explicit assignment
UPDATE course_practice_phrases
SET phrase_role = CASE
  WHEN position = 0 THEN 'component'
  WHEN position >= 8 THEN 'eternal_eligible'
  ELSE 'practice'
END
WHERE phrase_role = 'practice';  -- Only update rows with default value

-- Note: connected_lego_ids and lego_position require content analysis
-- and should be populated by the Dashboard during course generation.
-- They remain empty ({} and NULL) until Dashboard is updated.

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN course_practice_phrases.phrase_role IS
  'Explicit phrase category: component (M-type parts), practice (debut build-up), eternal_eligible (spaced rep)';

COMMENT ON COLUMN course_practice_phrases.connected_lego_ids IS
  'Other LEGO IDs that appear in this phrase. Used for coverage-based selection.';

COMMENT ON COLUMN course_practice_phrases.lego_position IS
  'Where the primary LEGO appears in target_text: start, middle, or end. Used for variety in selection.';

-- ============================================
-- UPDATE PRACTICE_CYCLES VIEW
-- Include new columns for selection algorithms
-- ============================================

DROP VIEW IF EXISTS practice_cycles;

CREATE VIEW practice_cycles AS
SELECT
  cpp.id,
  cpp.course_code,
  cpp.seed_number,
  cpp.lego_index,
  lc.lego_id,
  cpp.position,

  -- Explicit role from table
  cpp.phrase_role,

  -- Backwards-compatible phrase_type (computed from position)
  CASE
    WHEN cpp.position = 0 THEN 'component'
    WHEN cpp.position = 1 THEN 'debut'
    ELSE 'practice'
  END as phrase_type,

  -- Coverage metadata
  cpp.connected_lego_ids,
  cpp.lego_position,

  -- Practice metadata
  cpp.word_count,
  cpp.lego_count,
  cpp.target_syllable_count,
  cpp.difficulty,
  cpp.register,
  cpp.status,
  cpp.version,

  -- Text pair
  cpp.known_text,
  cpp.target_text,

  -- Audio refs (from lego_cycles)
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

-- Grant access
GRANT SELECT ON practice_cycles TO authenticated;
