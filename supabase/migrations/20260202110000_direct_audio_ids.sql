-- Direct audio IDs on course_legos and course_practice_phrases
-- Replaces fragile text-based lookups with explicit IDs on each row
-- Simple, robust, can't desync

-- ============================================
-- COURSE_LEGOS: Add direct audio ID + duration columns
-- ============================================

ALTER TABLE course_legos
ADD COLUMN IF NOT EXISTS known_audio_id TEXT,
ADD COLUMN IF NOT EXISTS target1_audio_id TEXT,
ADD COLUMN IF NOT EXISTS target2_audio_id TEXT,
ADD COLUMN IF NOT EXISTS target1_duration_ms INTEGER,
ADD COLUMN IF NOT EXISTS target2_duration_ms INTEGER;

-- Populate from course_audio using text lookup (one-time migration)
UPDATE course_legos cl
SET
  known_audio_id = (
    SELECT ca.id FROM course_audio ca
    WHERE ca.course_code = cl.course_code
      AND ca.text_normalized = lower(trim(cl.known_text))
      AND ca.role = 'known'
    LIMIT 1
  ),
  target1_audio_id = (
    SELECT ca.id FROM course_audio ca
    WHERE ca.course_code = cl.course_code
      AND ca.text_normalized = lower(trim(cl.target_text))
      AND ca.role = 'target1'
    LIMIT 1
  ),
  target2_audio_id = (
    SELECT ca.id FROM course_audio ca
    WHERE ca.course_code = cl.course_code
      AND ca.text_normalized = lower(trim(cl.target_text))
      AND ca.role = 'target2'
    LIMIT 1
  ),
  target1_duration_ms = (
    SELECT ca.duration_ms FROM course_audio ca
    WHERE ca.course_code = cl.course_code
      AND ca.text_normalized = lower(trim(cl.target_text))
      AND ca.role = 'target1'
    LIMIT 1
  ),
  target2_duration_ms = (
    SELECT ca.duration_ms FROM course_audio ca
    WHERE ca.course_code = cl.course_code
      AND ca.text_normalized = lower(trim(cl.target_text))
      AND ca.role = 'target2'
    LIMIT 1
  )
WHERE known_audio_id IS NULL
   OR target1_audio_id IS NULL
   OR target2_audio_id IS NULL;

-- ============================================
-- COURSE_PRACTICE_PHRASES: Add direct audio ID columns
-- ============================================

ALTER TABLE course_practice_phrases
ADD COLUMN IF NOT EXISTS known_audio_id TEXT,
ADD COLUMN IF NOT EXISTS target1_audio_id TEXT,
ADD COLUMN IF NOT EXISTS target2_audio_id TEXT,
ADD COLUMN IF NOT EXISTS target1_duration_ms INTEGER,
ADD COLUMN IF NOT EXISTS target2_duration_ms INTEGER;

-- Populate from course_audio using text lookup (one-time migration)
UPDATE course_practice_phrases pp
SET
  known_audio_id = (
    SELECT ca.id FROM course_audio ca
    WHERE ca.course_code = pp.course_code
      AND ca.text_normalized = lower(trim(pp.known_text))
      AND ca.role = 'known'
    LIMIT 1
  ),
  target1_audio_id = (
    SELECT ca.id FROM course_audio ca
    WHERE ca.course_code = pp.course_code
      AND ca.text_normalized = lower(trim(pp.target_text))
      AND ca.role = 'target1'
    LIMIT 1
  ),
  target2_audio_id = (
    SELECT ca.id FROM course_audio ca
    WHERE ca.course_code = pp.course_code
      AND ca.text_normalized = lower(trim(pp.target_text))
      AND ca.role = 'target2'
    LIMIT 1
  ),
  target1_duration_ms = (
    SELECT ca.duration_ms FROM course_audio ca
    WHERE ca.course_code = pp.course_code
      AND ca.text_normalized = lower(trim(pp.target_text))
      AND ca.role = 'target1'
    LIMIT 1
  ),
  target2_duration_ms = (
    SELECT ca.duration_ms FROM course_audio ca
    WHERE ca.course_code = pp.course_code
      AND ca.text_normalized = lower(trim(pp.target_text))
      AND ca.role = 'target2'
    LIMIT 1
  )
WHERE known_audio_id IS NULL
   OR target1_audio_id IS NULL
   OR target2_audio_id IS NULL;

-- ============================================
-- Add indexes for lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_course_legos_known_audio ON course_legos (known_audio_id) WHERE known_audio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_legos_target1_audio ON course_legos (target1_audio_id) WHERE target1_audio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_legos_target2_audio ON course_legos (target2_audio_id) WHERE target2_audio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_practice_phrases_known_audio ON course_practice_phrases (known_audio_id) WHERE known_audio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_practice_phrases_target1_audio ON course_practice_phrases (target1_audio_id) WHERE target1_audio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_practice_phrases_target2_audio ON course_practice_phrases (target2_audio_id) WHERE target2_audio_id IS NOT NULL;

-- ============================================
-- Comments
-- ============================================

COMMENT ON COLUMN course_legos.known_audio_id IS 'Direct audio UUID for known language prompt';
COMMENT ON COLUMN course_legos.target1_audio_id IS 'Direct audio UUID for target language voice 1';
COMMENT ON COLUMN course_legos.target2_audio_id IS 'Direct audio UUID for target language voice 2';
COMMENT ON COLUMN course_legos.target1_duration_ms IS 'Duration of target1 audio in milliseconds';
COMMENT ON COLUMN course_legos.target2_duration_ms IS 'Duration of target2 audio in milliseconds';

COMMENT ON COLUMN course_practice_phrases.known_audio_id IS 'Direct audio UUID for known language prompt';
COMMENT ON COLUMN course_practice_phrases.target1_audio_id IS 'Direct audio UUID for target language voice 1';
COMMENT ON COLUMN course_practice_phrases.target2_audio_id IS 'Direct audio UUID for target language voice 2';
COMMENT ON COLUMN course_practice_phrases.target1_duration_ms IS 'Duration of target1 audio in milliseconds';
COMMENT ON COLUMN course_practice_phrases.target2_duration_ms IS 'Duration of target2 audio in milliseconds';
