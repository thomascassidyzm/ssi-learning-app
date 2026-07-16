-- Seed the adaptation_v2 row in algorithm_config (2026-07-16 shadow-verdict
-- repair, fault 3 "config never seeded"). Before this, the row was entirely
-- absent — the app silently fell back to useAlgorithmConfig.ts's hardcoded
-- DEFAULT_ADAPTATION_V2, which happens to match the spec's shipping default
-- (enabled:true, shadow:true) but left the kill switch and rate-policy
-- bounds un-tunable without a code deploy. Values below are copied verbatim
-- from DEFAULT_ADAPTATION_V2 / DEFAULT_RATE_POLICY_BOUNDS
-- (packages/player-vue/src/composables/useAlgorithmConfig.ts,
-- packages/core/src/learning/ratePolicy.ts) so seeding this row is a no-op
-- for current behaviour — it only makes the knobs real.

INSERT INTO public.algorithm_config (key, config, description)
VALUES (
  'adaptation_v2',
  '{
    "enabled": true,
    "shadow": true,
    "stage2_enabled": false,
    "bounds": {
      "buildCount": { "floor": 3, "ceiling": 7, "scripted": 7, "step": 1 },
      "consolidateCount": { "floor": 1, "ceiling": 4, "scripted": 2, "step": 1 },
      "spacedRepCap": { "floor": 6, "ceiling": 12, "scripted": 12, "step": 1 },
      "pauseMultiplier": { "floor": 0.7, "ceiling": 1.4, "scripted": 1.0, "step": 0.05 },
      "breatherMinRoundGap": 3
    },
    "weights": { "duration": 0.5, "peaks": 0.3, "shape": 0.2 }
  }'::jsonb,
  'Adaptation v2 (workstream C) shadow-mode safety rails and rate-policy bounds — docs/adaptation/adaptation-v2-build-spec.md §6. enabled+shadow both true ships "compute and log, never apply". stage2_enabled gates the envelope-metadata track (WP-6..9), off until that lands.'
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
