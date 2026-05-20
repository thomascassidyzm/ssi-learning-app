-- Migration v2: repair INF PLAY highest_lego rows
-- (the v1 migration's correlated subquery inside FILTER didn't work
-- as intended — rows it should have updated were silently skipped.)
--
-- Sets highest_completed_lego_id + highest_completed_round_index to
-- the course's final main-loop LEGO for any enrollment already in
-- current_mode='infplay'. Forward-only via the WHERE clause; rows
-- already at the final (or beyond) aren't touched.

WITH finals AS (
  SELECT DISTINCT ON (course_code)
    course_code,
    'S' || lpad(seed_number::text, 4, '0') || 'L' || lpad(lego_index::text, 2, '0') AS final_lego_id
  FROM public.course_legos
  WHERE is_new = true
  ORDER BY course_code, seed_number DESC, lego_index DESC
),
counts AS (
  SELECT course_code, COUNT(*)::int - 1 AS final_round_index
  FROM public.course_legos
  WHERE is_new = true
  GROUP BY course_code
)
UPDATE public.course_enrollments e
SET
  highest_completed_lego_id = f.final_lego_id,
  highest_completed_round_index = c.final_round_index
FROM finals f
JOIN counts c ON c.course_code = f.course_code
WHERE e.course_id = f.course_code
  AND e.current_mode = 'infplay'
  AND (
    e.highest_completed_lego_id IS NULL
    OR e.highest_completed_lego_id < f.final_lego_id
  );

NOTIFY pgrst, 'reload schema';
