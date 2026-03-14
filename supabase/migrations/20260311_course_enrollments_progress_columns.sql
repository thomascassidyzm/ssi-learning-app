-- Add progress tracking columns to course_enrollments
-- These are used by ProgressStore, useBeltProgress, useAuth, and SettingsScreen

ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS last_completed_lego_id TEXT,
  ADD COLUMN IF NOT EXISTS last_completed_round_index INTEGER,
  ADD COLUMN IF NOT EXISTS highest_completed_seed INTEGER;
