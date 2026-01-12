-- ============================================
-- PRACTICE PROMPTS SCHEMA
-- Comprehensible input questions that elicit learned phrase responses
-- ============================================

-- Main prompts table
CREATE TABLE practice_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL REFERENCES courses(code),

  -- The question/prompt in target language
  prompt_target_text TEXT NOT NULL,           -- "Beth wyt ti'n moyn?"
  prompt_known_text TEXT,                      -- "What do you want?" (reference only)

  -- LEGOs that compose this prompt (for comprehensibility check)
  -- Question is "unlocked" when learner knows ALL of these
  prompt_lego_ids TEXT[] NOT NULL,            -- ['S0012L01', 'S0003L02', ...]

  -- Expected response(s)
  expected_lego_id TEXT,                       -- Primary expected LEGO response
  expected_phrase_id TEXT,                     -- Or a specific phrase from practice_cycles
  expected_target_text TEXT NOT NULL,          -- "Dw i'n moyn coffi" (denormalized for display)

  -- Alternative valid responses (learner might answer differently but correctly)
  alternative_responses JSONB,                 -- [{"target": "...", "lego_id": "..."}]

  -- Audio
  prompt_audio_uuid UUID,                      -- TTS or recorded audio for the prompt

  -- Categorization
  prompt_type TEXT DEFAULT 'open',             -- 'open', 'yes_no', 'choice', 'fill_blank'
  question_word TEXT,                          -- 'beth', 'ble', 'pwy', 'pryd', etc. (for Welsh)

  -- Difficulty/ordering
  difficulty_score INTEGER DEFAULT 1,          -- 1-5, computed or manual
  min_legos_required INTEGER,                  -- How many LEGOs learner needs before this unlocks

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,

  -- Constraints
  CONSTRAINT valid_prompt CHECK (prompt_target_text <> ''),
  CONSTRAINT valid_response CHECK (expected_target_text <> ''),
  CONSTRAINT has_lego_ids CHECK (array_length(prompt_lego_ids, 1) > 0)
);

-- Index for fast lookups by course
CREATE INDEX idx_practice_prompts_course ON practice_prompts(course_code);

-- Index for finding prompts by required LEGOs (GIN for array containment)
CREATE INDEX idx_practice_prompts_legos ON practice_prompts USING GIN(prompt_lego_ids);

-- ============================================
-- LEARNER PRACTICE HISTORY
-- Track which prompts a learner has practiced and how they performed
-- ============================================

CREATE TABLE learner_practice_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES auth.users(id),
  prompt_id UUID NOT NULL REFERENCES practice_prompts(id),

  -- Session context
  session_id UUID,                             -- Link to learning session if applicable
  practiced_at TIMESTAMPTZ DEFAULT NOW(),

  -- Response tracking
  response_audio_uuid UUID,                    -- If we record learner's response
  response_transcript TEXT,                    -- If we use speech-to-text

  -- Scoring
  was_correct BOOLEAN,                         -- Did they get it right?
  confidence_score NUMERIC(3,2),               -- 0.00-1.00 if using speech recognition
  response_time_ms INTEGER,                    -- How long they took to respond

  -- Self-assessment (if no speech recognition)
  self_rating INTEGER,                         -- 1-5 self-assessment

  -- Metadata
  device_type TEXT,                            -- 'ios', 'android', 'web'

  CONSTRAINT valid_self_rating CHECK (self_rating IS NULL OR self_rating BETWEEN 1 AND 5)
);

-- Index for learner lookup
CREATE INDEX idx_practice_history_learner ON learner_practice_history(learner_id);
CREATE INDEX idx_practice_history_prompt ON learner_practice_history(prompt_id);

-- ============================================
-- VIEW: Available prompts for a learner
-- Returns prompts where learner knows all required LEGOs
-- ============================================

-- This would be called with learner's known_lego_ids as parameter
-- Example: SELECT * FROM get_available_prompts('spa_for_eng', ARRAY['S0001L01', 'S0002L01', ...])

CREATE OR REPLACE FUNCTION get_available_prompts(
  p_course_code TEXT,
  p_known_lego_ids TEXT[]
)
RETURNS TABLE (
  id UUID,
  prompt_target_text TEXT,
  prompt_known_text TEXT,
  expected_target_text TEXT,
  prompt_type TEXT,
  difficulty_score INTEGER,
  prompt_audio_uuid UUID,
  comprehensibility_pct NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id,
    pp.prompt_target_text,
    pp.prompt_known_text,
    pp.expected_target_text,
    pp.prompt_type,
    pp.difficulty_score,
    pp.prompt_audio_uuid,
    -- Calculate what % of prompt LEGOs the learner knows
    (SELECT COUNT(*)::NUMERIC FROM unnest(pp.prompt_lego_ids) lid WHERE lid = ANY(p_known_lego_ids))
    / array_length(pp.prompt_lego_ids, 1) * 100 AS comprehensibility_pct
  FROM practice_prompts pp
  WHERE pp.course_code = p_course_code
    AND pp.is_active = true
    -- All prompt LEGOs must be known (100% comprehensibility)
    AND pp.prompt_lego_ids <@ p_known_lego_ids
  ORDER BY pp.difficulty_score ASC, random();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Prompts with partial comprehensibility (i+1)
-- For when you want to allow ~80% known vocabulary
-- ============================================

CREATE OR REPLACE FUNCTION get_i_plus_one_prompts(
  p_course_code TEXT,
  p_known_lego_ids TEXT[],
  p_min_comprehensibility NUMERIC DEFAULT 80.0
)
RETURNS TABLE (
  id UUID,
  prompt_target_text TEXT,
  prompt_known_text TEXT,
  expected_target_text TEXT,
  prompt_type TEXT,
  difficulty_score INTEGER,
  prompt_audio_uuid UUID,
  comprehensibility_pct NUMERIC,
  unknown_lego_ids TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id,
    pp.prompt_target_text,
    pp.prompt_known_text,
    pp.expected_target_text,
    pp.prompt_type,
    pp.difficulty_score,
    pp.prompt_audio_uuid,
    -- Calculate comprehensibility percentage
    (SELECT COUNT(*)::NUMERIC FROM unnest(pp.prompt_lego_ids) lid WHERE lid = ANY(p_known_lego_ids))
    / array_length(pp.prompt_lego_ids, 1) * 100 AS comprehensibility_pct,
    -- Return which LEGOs are unknown
    (SELECT ARRAY_AGG(lid) FROM unnest(pp.prompt_lego_ids) lid WHERE NOT lid = ANY(p_known_lego_ids)) AS unknown_lego_ids
  FROM practice_prompts pp
  WHERE pp.course_code = p_course_code
    AND pp.is_active = true
    -- At least X% of prompt LEGOs must be known
    AND (SELECT COUNT(*)::NUMERIC FROM unnest(pp.prompt_lego_ids) lid WHERE lid = ANY(p_known_lego_ids))
        / array_length(pp.prompt_lego_ids, 1) * 100 >= p_min_comprehensibility
  ORDER BY comprehensibility_pct DESC, pp.difficulty_score ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- EXAMPLE DATA
-- ============================================

/*
-- Welsh example prompts

INSERT INTO practice_prompts (course_code, prompt_target_text, prompt_known_text, prompt_lego_ids, expected_lego_id, expected_target_text, prompt_type, question_word)
VALUES
  ('cym_for_eng', 'Beth wyt ti''n moyn?', 'What do you want?',
   ARRAY['S0012L01', 'S0003L02', 'S0001L01'],
   'S0005L01', 'Dw i''n moyn coffi', 'open', 'beth'),

  ('cym_for_eng', 'Wyt ti''n siarad Cymraeg?', 'Do you speak Welsh?',
   ARRAY['S0003L02', 'S0008L01', 'S0010L01'],
   'S0008L02', 'Ydw, dw i''n siarad Cymraeg', 'yes_no', NULL),

  ('cym_for_eng', 'Ble wyt ti''n byw?', 'Where do you live?',
   ARRAY['S0015L01', 'S0003L02', 'S0020L01'],
   'S0020L02', 'Dw i''n byw yn Nghaerdydd', 'open', 'ble');
*/

-- ============================================
-- NOTES
-- ============================================

/*
COMPREHENSIBILITY CALCULATION:
- prompt_lego_ids contains all LEGOs used in the question
- At runtime, we check what % of these the learner knows
- 100% = fully comprehensible (learner knows all words)
- 80%+ = i+1 (learner knows most, learning from context)

RESPONSE VALIDATION OPTIONS:
1. Honor system: "Did you get it? Yes/No"
2. Tap to reveal: Show answer, learner self-assesses
3. Speech recognition: Compare learner audio to expected
4. Text input: Type the response (for writing practice)

AUDIO GENERATION:
- Can use same TTS pipeline as course audio
- Or record native speaker questions
- Link via prompt_audio_uuid to audio_samples table

FUTURE ENHANCEMENTS:
- Conversation chains: prompt → response → follow-up prompt
- Context images: visual prompts to aid comprehension
- Hints: show first word, show English, etc.
- Spaced repetition: track which prompts need review
*/
