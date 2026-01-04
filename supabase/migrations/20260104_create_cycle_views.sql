-- Create lego_cycles view
-- Joins course_legos with course_audio to provide all audio for the learning cycle
-- This view is used by the learning app to load session content

DROP VIEW IF EXISTS lego_cycles;

CREATE VIEW lego_cycles AS
SELECT
  cl.id,
  cl.course_code,
  cl.seed_number,
  cl.lego_index,
  cl.lego_id,
  cl.type,
  cl.is_new,
  cl.known_text,
  cl.target_text,
  cl.components,
  cl.status,
  -- Known audio (prompt in user's language)
  ka.id AS known_audio_uuid,
  ka.s3_key AS known_s3_key,
  ka.duration_ms AS known_duration_ms,
  -- Target voice 1 (first target language voice)
  t1.id AS target1_audio_uuid,
  t1.s3_key AS target1_s3_key,
  t1.duration_ms AS target1_duration_ms,
  -- Target voice 2 (second target language voice)
  t2.id AS target2_audio_uuid,
  t2.s3_key AS target2_s3_key,
  t2.duration_ms AS target2_duration_ms
FROM course_legos cl
LEFT JOIN course_audio ka
  ON ka.course_code = cl.course_code
  AND ka.text_normalized = lower(trim(cl.known_text))
  AND ka.role = 'known'
LEFT JOIN course_audio t1
  ON t1.course_code = cl.course_code
  AND t1.text_normalized = lower(trim(cl.target_text))
  AND t1.role = 'target1'
LEFT JOIN course_audio t2
  ON t2.course_code = cl.course_code
  AND t2.text_normalized = lower(trim(cl.target_text))
  AND t2.role = 'target2';

-- Create practice_cycles view
-- Joins course_practice_phrases with course_audio for practice phrase audio

DROP VIEW IF EXISTS practice_cycles;

CREATE VIEW practice_cycles AS
SELECT
  pp.id,
  pp.course_code,
  pp.seed_number,
  pp.lego_index,
  pp.position,
  -- Construct lego_id from seed_number and lego_index (format: S0001L01)
  'S' || lpad(pp.seed_number::text, 4, '0') || 'L' || lpad(pp.lego_index::text, 2, '0') AS lego_id,
  pp.known_text,
  pp.target_text,
  pp.word_count AS target_word_count,
  pp.target_syllable_count,
  pp.difficulty,
  pp.status,
  -- Known audio
  ka.id AS known_audio_uuid,
  ka.s3_key AS known_s3_key,
  ka.duration_ms AS known_duration_ms,
  -- Target voice 1
  t1.id AS target1_audio_uuid,
  t1.s3_key AS target1_s3_key,
  t1.duration_ms AS target1_duration_ms,
  -- Target voice 2
  t2.id AS target2_audio_uuid,
  t2.s3_key AS target2_s3_key,
  t2.duration_ms AS target2_duration_ms
FROM course_practice_phrases pp
LEFT JOIN course_audio ka
  ON ka.course_code = pp.course_code
  AND ka.text_normalized = lower(trim(pp.known_text))
  AND ka.role = 'known'
LEFT JOIN course_audio t1
  ON t1.course_code = pp.course_code
  AND t1.text_normalized = lower(trim(pp.target_text))
  AND t1.role = 'target1'
LEFT JOIN course_audio t2
  ON t2.course_code = pp.course_code
  AND t2.text_normalized = lower(trim(pp.target_text))
  AND t2.role = 'target2';

-- Grant access to anon role for the views
GRANT SELECT ON lego_cycles TO anon;
GRANT SELECT ON practice_cycles TO anon;
