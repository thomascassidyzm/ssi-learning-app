-- Migration: ratchet highest_completed_lego_id to course's final LEGO
-- for any enrollment already in current_mode='infplay'.
--
-- Per Tom 2026-05-20: belt-skipping past content is the legitimate
-- way to enter INF PLAY ("how the fuck do I get beyond the highest
-- lego if not by skipping past it"). The data model has to accept
-- that. Entering INF PLAY = "I'm done with new content" — highest
-- should reflect that even if the learner didn't literally play
-- every belt.
--
-- This patch repairs rows the old logic left in inconsistent state
-- (mode='infplay' but highest_lego pointing at some earlier belt).
-- The in-app fix (commit pending) prevents NEW corruption; this
-- handles existing rows.

WITH course_finals AS (
  SELECT
    course_code,
    'S' || lpad(MAX(seed_number)::text, 4, '0') || 'L' || lpad(MAX(lego_index) FILTER (WHERE seed_number = (
      SELECT MAX(seed_number) FROM public.course_legos cl2
      WHERE cl2.course_code = cl.course_code AND cl2.is_new = true
    ))::text, 2, '0') AS final_lego_id,
    COUNT(*) AS main_loop_count
  FROM public.course_legos cl
  WHERE is_new = true
  GROUP BY course_code
)
UPDATE public.course_enrollments e
SET
  highest_completed_lego_id = cf.final_lego_id,
  highest_completed_round_index = cf.main_loop_count - 1
FROM course_finals cf
WHERE e.course_id = cf.course_code
  AND e.current_mode = 'infplay'
  AND (
    e.highest_completed_lego_id IS NULL
    OR e.highest_completed_lego_id < cf.final_lego_id
  );

NOTIFY pgrst, 'reload schema';
