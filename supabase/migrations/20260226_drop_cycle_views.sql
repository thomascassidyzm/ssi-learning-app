-- Drop practice_cycles and lego_cycles views
-- These views do 3 LEFT JOINs on lower(trim(text)) against course_audio per row,
-- taking 5+ minutes for a full course. Multiple concurrent queries exhausted the
-- connection pool and took down the database on 2026-02-26.
--
-- All code now queries course_practice_phrases and course_legos directly,
-- which have audio IDs denormalized on the rows (added in 20260202110000_direct_audio_ids.sql).

DROP VIEW IF EXISTS practice_cycles;
DROP VIEW IF EXISTS lego_cycles;
