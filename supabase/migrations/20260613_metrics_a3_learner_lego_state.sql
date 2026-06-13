-- A3 (metrics workstream) — Layer-1 per-(learner, LEGO) state.
--
-- Extends the EXISTING learner_lego_metrics table into the Layer-1 state the
-- curvature sensor (B1), local-difficulty sensing (B4), and the adaptation
-- controller (M2) read — rather than standing up a parallel learner_lego_state
-- table. BSC: reuses the table's existing PK, own-row RLS, and the writer that
-- already upserts every 10 cycles + on pagehide; adds columns, no new surface.
--
-- Grounded in: docs/methodology/metrics-architecture.md §8 (Layer 1 schema),
--              docs/methodology/metrics-implementation-plan.md workstream A3.
--
-- Additive and reversible. DRAFT — apply with the service role.

ALTER TABLE learner_lego_metrics
  ADD COLUMN IF NOT EXISTS mean_latency_ms    REAL,                                  -- rolling, recency-weighted normalized latency: the difficulty-bearing series the curvature sensor reads
  ADD COLUMN IF NOT EXISTS mean_exec_score    REAL,                                  -- rolling execution score [0,1]; behavioural proxy now, prosody later. Null until execution data flows
  ADD COLUMN IF NOT EXISTS skip_back_count    INTEGER     NOT NULL DEFAULT 0,        -- phase_skip direction=back: "let me re-hear" / low-confidence (§5)
  ADD COLUMN IF NOT EXISTS skip_forward_count INTEGER     NOT NULL DEFAULT 0,        -- phase_skip direction=forward: confidence (§5)
  ADD COLUMN IF NOT EXISTS next_due_at        TIMESTAMPTZ,                           -- spaced-repetition next-due (Fibonacci): the deferral return trigger (M2)
  ADD COLUMN IF NOT EXISTS device_class_mix   JSONB       NOT NULL DEFAULT '{}'::jsonb; -- counts by device_class {class_play,homework,tutor_session} (§7): stops class-play aggregate from polluting individual execution

COMMENT ON COLUMN learner_lego_metrics.mean_latency_ms    IS 'Rolling recency-weighted normalized response latency (ms). The difficulty-bearing series curvature reads.';
COMMENT ON COLUMN learner_lego_metrics.mean_exec_score    IS 'Rolling execution score in [0,1]. Behavioural proxy now (B2), prosody later. NULL until execution data exists.';
COMMENT ON COLUMN learner_lego_metrics.skip_back_count    IS 'Count of phase_skip direction=back for this (learner, lego) — low-confidence / re-hear signal.';
COMMENT ON COLUMN learner_lego_metrics.skip_forward_count IS 'Count of phase_skip direction=forward — confidence signal.';
COMMENT ON COLUMN learner_lego_metrics.next_due_at        IS 'Spaced-repetition next-due timestamp (Fibonacci schedule). Deferral return trigger.';
COMMENT ON COLUMN learner_lego_metrics.device_class_mix   IS 'Counts by device_class: {class_play, homework, tutor_session}. Keeps aggregate class audio from polluting individual scores.';

-- RLS: learner_lego_metrics already has own-row SELECT/INSERT/UPDATE/DELETE
-- policies; new columns inherit them. No policy change needed.

NOTIFY pgrst, 'reload schema';
