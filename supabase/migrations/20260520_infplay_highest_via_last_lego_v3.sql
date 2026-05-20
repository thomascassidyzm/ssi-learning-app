-- Migration v3: repair INF PLAY highest_lego rows (v1+v2 were no-ops)
--
-- v1 and v2 both wrote directly to highest_completed_lego_id. The
-- ratchet trigger from 20260512_lego_id_independent_ratchet.sql
-- silently reverts ANY direct write to highest_completed_lego_id
-- in its ELSE branch (NEW.highest_completed_lego_id := prev_high_lego).
-- The trigger only ratchets highest THROUGH writes to
-- last_completed_lego_id.
--
-- v3 writes to last_completed_lego_id. The trigger then ratchets
-- highest_completed_lego_id to match. last_completed_round_index
-- is left untouched (cursor's round_index may legitimately be deep
-- into infplay territory and shouldn't regress to the final main-
-- loop round index).

WITH finals AS (
  SELECT DISTINCT ON (course_code)
    course_code,
    'S' || lpad(seed_number::text, 4, '0') || 'L' || lpad(lego_index::text, 2, '0') AS final_lego_id
  FROM public.course_legos
  WHERE is_new = true
  ORDER BY course_code, seed_number DESC, lego_index DESC
)
UPDATE public.course_enrollments e
SET last_completed_lego_id = f.final_lego_id
FROM finals f
WHERE e.course_id = f.course_code
  AND e.current_mode = 'infplay'
  AND (
    e.last_completed_lego_id IS NULL
    OR e.last_completed_lego_id < f.final_lego_id
  );

-- Trigger ratchets highest_completed_lego_id from the new
-- last_completed_lego_id automatically. No direct write needed.

NOTIFY pgrst, 'reload schema';
