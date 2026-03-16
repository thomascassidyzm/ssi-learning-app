-- Optional component introduction
-- Components with introduce=false still exist for tiling validation
-- but are not presented to the learner (no component_intro/component_practice cycles).
-- Default true preserves existing behaviour for all current data.

ALTER TABLE course_practice_phrases
ADD COLUMN introduce BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN course_practice_phrases.introduce IS
  'When false, component exists for tiling validation but is not presented to the learner';
