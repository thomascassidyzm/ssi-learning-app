-- Migration: surface remaining magic numbers via algorithm_config
-- Purpose: pull Layer 2 pod scheduler params, script-shape phrase counts,
--          and Turbo culling rules out of source code.
-- Philosophy: "Everything is a parameter."

-- Layer 2 — pod scheduler runtime config (gaps + stage progression).
-- Numbers mirror constants in usePodLapScheduler.ts and LearningPlayer.vue
-- as of 2026-05-06 (Aran's road-test playlist + gap matrix).
INSERT INTO algorithm_config (key, config, description, updated_by) VALUES
(
  'pods',
  '{
    "stagePlaylist": {
      "1": ["ps", "trans", "ps", "ps"],
      "2": ["ps", "trans", "ps2x", "ps2x"],
      "3": ["ps", "trans", "ps2x"],
      "4": ["ps2x", "trans", "ps2x"],
      "5": ["ps", "ps2x"],
      "6": ["ps2x", "ps2x"],
      "7": ["ps2x"]
    },
    "stageDuration": 5,
    "gapSuperTightMs": 100,
    "gapTightMs": 200,
    "gapGluedMs": 300,
    "gapBetweenMs": 1000
  }'::jsonb,
  'Layer 2 (Listening Pod) scheduler. stagePlaylist: per-stage role sequences. stageDuration: pod-rounds per stage 1-6 (stage 7 eternal). gap*Ms: inter-play timing matrix.',
  'system'
)
ON CONFLICT (key) DO NOTHING;

-- Script generation — phrase counts per round + Fibonacci spaced-rep schedule.
-- Numbers mirror the constants block at the top of generateLearningScript.ts.
INSERT INTO algorithm_config (key, config, description, updated_by) VALUES
(
  'script_shape',
  '{
    "spacedRepOffsets": [1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
    "maxBuildPhrases": 7,
    "useConsolidationCount": 2,
    "maxSpacedRepPhrases": 12,
    "n1PhraseCount": 3
  }'::jsonb,
  'Per-round script shape: how many BUILD/USE phrases, total spaced-rep cap, fib decay schedule, and N-1 review reps. Changing any of these reshapes every learner''s round structure on next session.',
  'system'
)
ON CONFLICT (key) DO NOTHING;

-- Backfill turbo_boost with culling rules (which phrases Turbo skips).
-- Uses ||-with-new-fields-first so any manual edits already on the row
-- take precedence on conflict.
UPDATE algorithm_config
SET config = '{
  "fibKeep": [0, 1, 2, 4, 6, 8],
  "buildKeep": 3,
  "useKeep": 1
}'::jsonb || config
WHERE key = 'turbo_boost';
