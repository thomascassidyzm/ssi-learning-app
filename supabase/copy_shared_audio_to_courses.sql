-- ============================================
-- COPY SHARED_AUDIO TO COURSE_AUDIO
--
-- Copies instructions and encouragements from shared_audio
-- to course_audio for all courses with matching known_lang.
-- Skips any that already exist (ON CONFLICT DO NOTHING).
--
-- Run this once to populate existing courses.
-- Future: This logic should be in the dashboard import process.
-- ============================================

-- First, let's see what we're about to copy
SELECT
  'shared_audio' as source,
  audio_type,
  COUNT(*) as count
FROM shared_audio
WHERE audio_type IN ('instruction', 'encouragement')
GROUP BY audio_type;

-- Check which courses will receive the audio
SELECT code, known_lang, target_lang
FROM courses
WHERE known_lang = 'eng';

-- Check what already exists
SELECT
  course_code,
  role,
  COUNT(*) as existing_count
FROM course_audio
WHERE role IN ('instruction', 'encouragement')
GROUP BY course_code, role
ORDER BY course_code, role;

-- ============================================
-- COPY INSTRUCTIONS (in sequence order)
-- Skip duplicates using ON CONFLICT DO NOTHING
-- ============================================
INSERT INTO course_audio (
  course_code,
  text,
  text_normalized,
  language,
  role,
  voice_id,
  origin,
  s3_key,
  duration_ms,
  created_at
)
SELECT
  c.code as course_code,
  sa.text,
  sa.text_normalized,
  sa.language,
  'instruction' as role,
  sa.voice_id,
  sa.origin,
  sa.s3_key,
  sa.duration_ms,
  NOW()
FROM shared_audio sa
CROSS JOIN courses c
WHERE sa.audio_type = 'instruction'
  AND c.known_lang = sa.language
ORDER BY c.code, sa.sequence
ON CONFLICT (course_code, text_normalized, language, role) DO NOTHING;

-- ============================================
-- COPY ENCOURAGEMENTS (no sequence needed - random pool)
-- Skip duplicates using ON CONFLICT DO NOTHING
-- ============================================
INSERT INTO course_audio (
  course_code,
  text,
  text_normalized,
  language,
  role,
  voice_id,
  origin,
  s3_key,
  duration_ms,
  created_at
)
SELECT
  c.code as course_code,
  sa.text,
  sa.text_normalized,
  sa.language,
  'encouragement' as role,
  sa.voice_id,
  sa.origin,
  sa.s3_key,
  sa.duration_ms,
  NOW()
FROM shared_audio sa
CROSS JOIN courses c
WHERE sa.audio_type = 'encouragement'
  AND c.known_lang = sa.language
ON CONFLICT (course_code, text_normalized, language, role) DO NOTHING;

-- ============================================
-- VERIFY THE COPY
-- ============================================
SELECT
  course_code,
  role,
  COUNT(*) as count
FROM course_audio
WHERE role IN ('instruction', 'encouragement')
GROUP BY course_code, role
ORDER BY course_code, role;
