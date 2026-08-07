-- Turbo retirement — the DDL half.
--
-- Turbo was retired as a learner CHOICE on 2026-08-06 (Aran's two-mode ruling:
-- there is exactly `easy` and `fast`). This removes the residue it left in the
-- database. Zero learners were ever on Turbo — `turbo_mode_enabled` was FALSE
-- on all 1,092 learner rows that carried it (censused live 2026-08-07) — so
-- every statement here is behaviourally a no-op, which is the safety argument.
--
-- STATUS WHEN WRITTEN: the two DML halves were already applied live on
-- 2026-08-07 by the service-role client, which cannot issue DDL:
--   • the `turbo_boost` row was deleted from algorithm_config
--     (tools/delete-turbo-boost-applied-log.json holds its config, so it is
--      recoverable);
--   • `turbo_mode_enabled` was stripped from all 1,092 learners.preferences
--     blobs (tools/strip-turbo-mode-enabled-applied-log.json; reconciled
--      1092 -> 0).
-- Both are repeated here idempotently so this file is a complete, replayable
-- description of the end state.
--
-- THE PART THAT STILL NEEDS APPLYING is the column default. It requires a
-- direct SUPABASE_DB_URL, which the applying session did not have. UNTIL IT
-- RUNS, EVERY NEWLY-CREATED LEARNER IS STILL BORN WITH THE DEAD KEY and the
-- row sweep silently undoes itself one learner at a time. Re-run the sweep
-- (tools/strip-turbo-mode-enabled.mjs) after applying this, to catch any
-- learner created in the gap.
--
-- NOT TOUCHED, DELIBERATELY:
--   • `algorithm_config.normal_mode` is NOT Turbo residue. It is fast_mode's
--     live promotion-window fallback alias (useAlgorithmConfig.ts reads
--     `loaded.fast_mode || loaded.normal_mode`) so an old bundle on a new DB
--     and a new bundle on an old DB both work. Removing it breaks the window.
--   • The 'turbo_toggle' player_events rows and the rollup function that
--     counts them. That is historical behavioural evidence; deleting it would
--     silently rewrite the past.

BEGIN;

-- 1. The dead mode-config row. Nothing reads it: useAlgorithmConfig resolves
--    only fast_mode/easy_mode, and learningModes.test.ts pins that the key is
--    never read even when the row IS present.
DELETE FROM public.algorithm_config WHERE key = 'turbo_boost';

-- 2. The stale column comment listed turbo_boost as an example key.
COMMENT ON COLUMN public.algorithm_config.key IS
  'Unique identifier: fast_mode, easy_mode, listening, pods, script_shape, adaptation_v2, etc.';

-- 3. THE ONE THAT MATTERS. The column default still minted the dead key onto
--    every new learner. Same JSON, minus turbo_mode_enabled.
ALTER TABLE public.learners
  ALTER COLUMN preferences
  SET DEFAULT '{"volume": 1.0, "encouragements_enabled": true, "session_duration_minutes": 15}'::jsonb;

-- 4. Idempotent re-assertion of the row sweep, for any learner created between
--    the sweep and this migration.
UPDATE public.learners
   SET preferences = preferences - 'turbo_mode_enabled'
 WHERE preferences ? 'turbo_mode_enabled';

COMMIT;

NOTIFY pgrst, 'reload schema';
