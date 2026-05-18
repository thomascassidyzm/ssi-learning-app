-- Lightweight per-course counts exposed as a view for the learning app.
--
-- Why: Popty shows lego/phrase/audio counts on its course-overview screen by
-- querying course_legos / course_practice_phrases / course_audio live. The
-- learning-app wants the same lego_count to render the proper LEGO-based
-- progress fraction on the course tile, instead of a seed-only fraction.
-- A view keeps Popty as the SSoT (no risk of drift from a separately-
-- maintained column) and avoids dragging the dashboard team into a tile
-- denominator change.
--
-- A view recomputes per query, which is fine here — course_legos /
-- course_practice_phrases are small enough that COUNT(*) is sub-millisecond,
-- and this view is hit at most once per learning-app page load.
--
-- Permissive grant matches the content-table convention (course_legos itself
-- has RLS disabled per CLAUDE.md "keep content tables permissive").

CREATE OR REPLACE VIEW course_stats AS
SELECT
  cl.course_code,
  COUNT(*) AS lego_count
FROM course_legos cl
GROUP BY cl.course_code;

GRANT SELECT ON course_stats TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
