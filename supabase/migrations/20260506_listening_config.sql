-- Migration: seed listening config in algorithm_config
-- Purpose: make all Layer 1 / Layer 2 listening knobs DB-tweakable
--          (graduation offset, active/reserve windows, per-seed playlist,
--          pod activation default).
-- Philosophy: "Everything is a parameter."

INSERT INTO algorithm_config (key, config, description, updated_by) VALUES
(
  'listening',
  '{
    "enabled": true,
    "offset": 56,
    "l1ActiveSize": 10,
    "l1ActiveInterval": 3,
    "l1ReserveSize": 50,
    "l1ReserveInterval": 13,
    "layer1Playlist": ["ps", "ps2x", "ps2x"],
    "podActivationRound": 6
  }'::jsonb,
  'Layer 1 + Layer 2 listening config. layer1Playlist roles: ps=target@1x, ps2x=target@2x, trans=known@1x. podActivationRound is the global default; per-learner pin in course_enrollments still overrides.',
  'system'
)
ON CONFLICT (key) DO NOTHING;
