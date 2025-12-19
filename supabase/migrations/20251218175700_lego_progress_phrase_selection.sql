-- ============================================
-- LEGO Progress: Phrase Selection Columns
--
-- Adds columns needed for tracking introduction
-- sequence and eternal phrase selection (urn state)
--
-- See: apml/learning/phrase-selection.apml
-- ============================================

-- Introduction tracking
ALTER TABLE lego_progress
ADD COLUMN IF NOT EXISTS introduction_played BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE lego_progress
ADD COLUMN IF NOT EXISTS introduction_index SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE lego_progress
ADD COLUMN IF NOT EXISTS introduction_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Eternal phrase selection (random urn state)
-- Stores array of phrase IDs remaining in current urn
ALTER TABLE lego_progress
ADD COLUMN IF NOT EXISTS eternal_urn JSONB NOT NULL DEFAULT '[]';

-- Comments
COMMENT ON COLUMN lego_progress.introduction_played IS 'Has the LEGO introduction audio been played?';
COMMENT ON COLUMN lego_progress.introduction_index IS 'Position in introduction sequence (0=first component)';
COMMENT ON COLUMN lego_progress.introduction_complete IS 'Has full introduction sequence been completed?';
COMMENT ON COLUMN lego_progress.eternal_urn IS 'Remaining phrase IDs in random urn for spaced rep selection';
