-- Add presentation_audio_id column to course_legos table
-- This stores the intro audio UUID directly on the LEGO for consistent lookup
-- Same pattern as known_audio_id, target1_audio_id, target2_audio_id

ALTER TABLE course_legos
ADD COLUMN IF NOT EXISTS presentation_audio_id TEXT;

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_course_legos_presentation_audio
ON course_legos (presentation_audio_id)
WHERE presentation_audio_id IS NOT NULL;

-- Migrate existing presentation audio from course_audio table
-- course_audio has lego_id and role='presentation' with s3_key containing the UUID
UPDATE course_legos cl
SET presentation_audio_id = (
  SELECT
    -- Extract UUID from s3_key (handles both "mastered/{uuid}.mp3" and "{uuid}.mp3")
    REGEXP_REPLACE(
      REGEXP_REPLACE(ca.s3_key, '^mastered/', ''),
      '\.mp3$', ''
    )
  FROM course_audio ca
  WHERE ca.course_code = cl.course_code
    AND ca.lego_id = CONCAT('S', LPAD(cl.seed_number::text, 4, '0'), 'L', LPAD(cl.lego_index::text, 2, '0'))
    AND ca.role = 'presentation'
  LIMIT 1
)
WHERE cl.is_new = true
  AND cl.presentation_audio_id IS NULL;

-- Also try migrating from lego_introductions table (legacy)
UPDATE course_legos cl
SET presentation_audio_id = COALESCE(
  cl.presentation_audio_id,
  (
    SELECT COALESCE(li.presentation_audio_id::text, li.audio_uuid::text)
    FROM lego_introductions li
    WHERE li.course_code = cl.course_code
      AND li.lego_id = CONCAT('S', LPAD(cl.seed_number::text, 4, '0'), 'L', LPAD(cl.lego_index::text, 2, '0'))
    LIMIT 1
  )
)
WHERE cl.is_new = true
  AND cl.presentation_audio_id IS NULL;

COMMENT ON COLUMN course_legos.presentation_audio_id IS
'Audio UUID for LEGO introduction ("The Spanish for X is..."). Only populated for is_new=true LEGOs. Same lookup pattern as known_audio_id, target1_audio_id, target2_audio_id.';
