-- Migration: Populate component phrases for all M-type LEGOs
-- Date: 2026-01-19
-- Purpose: Mark phrases as 'component' if they don't contain the full LEGO text
--
-- Logic: For M-type LEGOs, any practice phrase where target_text does NOT contain
-- the entire LEGO's target_text must be a component (a building block of the LEGO)
--
-- Example: LEGO "quiero hablar" (I want to speak)
--   - "quiero" alone → component
--   - "hablar" alone → component
--   - "quiero hablar español" → contains full LEGO, so NOT a component (practice phrase)

-- Update practice phrases to 'component' where they don't contain the full LEGO text
UPDATE course_practice_phrases cpp
SET phrase_role = 'component'
FROM course_legos cl
WHERE cpp.course_code = cl.course_code
  AND cpp.seed_number = cl.seed_number
  AND cpp.lego_index = cl.lego_index
  AND cl.type = 'M'
  AND lower(cpp.target_text) NOT LIKE '%' || lower(cl.target_text) || '%'
  AND cpp.phrase_role != 'component';

-- Report how many were updated
DO $$
DECLARE
  component_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO component_count
  FROM course_practice_phrases
  WHERE phrase_role = 'component';

  RAISE NOTICE 'Total component phrases after migration: %', component_count;
END $$;
