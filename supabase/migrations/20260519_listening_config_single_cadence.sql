-- Migration: collapse L1 listening config to single cadence + queue.
-- Purpose: 2026-05-19 simplification of the listening algorithm —
--          ONE cadence (variable per L1 cluster size) + ONE rotating
--          lane queue replaces four coprime cadences + priority mutex
--          + adjacency cooldown. The new logic ignores the old fields
--          (l1ActiveInterval / l1ReserveInterval / l1RetiredInterval)
--          and reads l1Cadence + l1QueueTemplate instead. This patch
--          rewrites the row so the stored config matches what the code
--          actually consumes.
--
-- Defaults match generateLearningScript.ts:DEFAULT_LISTENING_CONFIG and
-- useAlgorithmConfig.ts:DEFAULT_LISTENING. l1Cadence MUST stay coprime
-- with PodsConfig.roundInterval (default 5) or L1 stalls under the
-- adjacency rule — 3, 6, 7 are safe; 4, 5, 10, 15 are not.

UPDATE algorithm_config
SET config = '{
  "enabled": true,
  "offset": 90,
  "l1ActiveSize": 10,
  "l1ReserveSize": 50,
  "l1UrnPullCount": 10,
  "l1Cadence": 3,
  "l1QueueTemplate": ["active", "active", "reserve", "active", "retired"],
  "layer1Playlist": ["ps", "ps2x", "ps2x"],
  "layer1StagePlaylist": {
    "1": ["ps", "ps2x", "ps2x"],
    "2": ["ps2x", "ps2x", "ps2x"],
    "3": ["ps2x", "ps2x"],
    "4": ["ps2x"]
  },
  "layer1StageDuration": 3
}'::jsonb,
    description = 'Layer 1 listening — single cadence + rotating queue (2026-05-19). l1Cadence rounds between L1 fires (must be coprime with pods.roundInterval). l1QueueTemplate rotates lanes per slot; empty lanes skip. Stage playlist drives per-seed decay.',
    updated_by = 'system'
WHERE key = 'listening';

NOTIFY pgrst, 'reload schema';
