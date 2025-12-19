-- Add welcome audio support to courses
-- The welcome audio plays once when a learner first loads a course

-- Add welcome audio columns to courses table
ALTER TABLE courses
ADD COLUMN IF NOT EXISTS welcome_audio_uuid TEXT,
ADD COLUMN IF NOT EXISTS welcome_audio_duration_ms INTEGER;

-- Add welcome_played flag to course_enrollments
ALTER TABLE course_enrollments
ADD COLUMN IF NOT EXISTS welcome_played BOOLEAN DEFAULT FALSE;

-- Comment
COMMENT ON COLUMN courses.welcome_audio_uuid IS 'UUID of welcome/introduction audio that plays on first course load';
COMMENT ON COLUMN courses.welcome_audio_duration_ms IS 'Duration of welcome audio in milliseconds';
COMMENT ON COLUMN course_enrollments.welcome_played IS 'True if learner has heard (or skipped) the welcome audio';
