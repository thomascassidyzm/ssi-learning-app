-- ============================================
-- CYCLE-READY VIEWS
-- Self-contained learning units with audio
--
-- These views join content tables with audio_samples
-- to produce complete "cycle items" ready for the
-- learning engine. One query = one playable unit.
-- ============================================

-- Performance index for text-based audio lookups
CREATE INDEX IF NOT EXISTS idx_audio_samples_text_role
ON audio_samples (text_normalized, role);

-- ============================================
-- LEGO CYCLES
-- Complete LEGO learning items with audio
-- ============================================
CREATE OR REPLACE VIEW lego_cycles AS
SELECT
  -- Identity
  l.id,
  l.lego_id,
  l.course_code,
  l.seed_number,
  l.lego_index,

  -- LEGO metadata
  l.type,
  l.is_new,
  l.components,
  l.status,
  l.version,

  -- Text pair
  l.known_text,
  l.target_text,

  -- Known audio (source language)
  ka.uuid AS known_audio_uuid,
  ka.duration_ms AS known_duration_ms,

  -- Target audio voice 1
  t1.uuid AS target1_audio_uuid,
  t1.duration_ms AS target1_duration_ms,

  -- Target audio voice 2
  t2.uuid AS target2_audio_uuid,
  t2.duration_ms AS target2_duration_ms

FROM course_legos l
LEFT JOIN audio_samples ka
  ON lower(trim(l.known_text)) = ka.text_normalized
  AND ka.role = 'source'
LEFT JOIN audio_samples t1
  ON lower(trim(l.target_text)) = t1.text_normalized
  AND t1.role = 'target1'
LEFT JOIN audio_samples t2
  ON lower(trim(l.target_text)) = t2.text_normalized
  AND t2.role = 'target2';

-- ============================================
-- PRACTICE CYCLES
-- Complete practice phrase learning items with audio
-- ============================================
CREATE OR REPLACE VIEW practice_cycles AS
SELECT
  -- Identity
  p.id,
  p.course_code,
  p.seed_number,
  p.lego_index,
  p.position,

  -- Computed LEGO ID for grouping
  'S' || lpad(p.seed_number::text, 4, '0') || 'L' || lpad(p.lego_index::text, 2, '0') AS lego_id,

  -- Phrase type (computed from position)
  CASE
    WHEN p.position = 0 THEN 'component'
    WHEN p.position = 1 THEN 'debut'
    WHEN p.position BETWEEN 2 AND 7 THEN 'practice'
    ELSE 'eternal'
  END AS phrase_type,

  -- Practice metadata
  p.word_count,
  p.lego_count,
  p.difficulty,
  p.register,
  p.status,
  p.version,

  -- Text pair
  p.known_text,
  p.target_text,

  -- Known audio (source language)
  ka.uuid AS known_audio_uuid,
  ka.duration_ms AS known_duration_ms,

  -- Target audio voice 1
  t1.uuid AS target1_audio_uuid,
  t1.duration_ms AS target1_duration_ms,

  -- Target audio voice 2
  t2.uuid AS target2_audio_uuid,
  t2.duration_ms AS target2_duration_ms

FROM course_practice_phrases p
LEFT JOIN audio_samples ka
  ON lower(trim(p.known_text)) = ka.text_normalized
  AND ka.role = 'source'
LEFT JOIN audio_samples t1
  ON lower(trim(p.target_text)) = t1.text_normalized
  AND t1.role = 'target1'
LEFT JOIN audio_samples t2
  ON lower(trim(p.target_text)) = t2.text_normalized
  AND t2.role = 'target2';

-- ============================================
-- SEED CYCLES
-- Complete seed learning items with audio
-- ============================================
CREATE OR REPLACE VIEW seed_cycles AS
SELECT
  -- Identity
  s.id,
  s.seed_id,
  s.course_code,
  s.seed_number,

  -- Seed metadata
  s.status,
  s.version,

  -- Text pair
  s.known_text,
  s.target_text,

  -- Known audio (source language)
  ka.uuid AS known_audio_uuid,
  ka.duration_ms AS known_duration_ms,

  -- Target audio voice 1
  t1.uuid AS target1_audio_uuid,
  t1.duration_ms AS target1_duration_ms,

  -- Target audio voice 2
  t2.uuid AS target2_audio_uuid,
  t2.duration_ms AS target2_duration_ms

FROM course_seeds s
LEFT JOIN audio_samples ka
  ON lower(trim(s.known_text)) = ka.text_normalized
  AND ka.role = 'source'
LEFT JOIN audio_samples t1
  ON lower(trim(s.target_text)) = t1.text_normalized
  AND t1.role = 'target1'
LEFT JOIN audio_samples t2
  ON lower(trim(s.target_text)) = t2.text_normalized
  AND t2.role = 'target2';

-- ============================================
-- RLS POLICIES FOR VIEWS
-- Views inherit from underlying tables, but we
-- explicitly grant read access to authenticated users
-- ============================================

-- Grant read access to authenticated users
GRANT SELECT ON lego_cycles TO authenticated;
GRANT SELECT ON practice_cycles TO authenticated;
GRANT SELECT ON seed_cycles TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON VIEW lego_cycles IS 'Self-contained LEGO learning items with audio refs. One row = one playable cycle.';
COMMENT ON VIEW practice_cycles IS 'Self-contained practice phrase items with audio refs. One row = one playable cycle.';
COMMENT ON VIEW seed_cycles IS 'Self-contained seed items with audio refs. One row = one playable cycle.';
