-- ============================================================================
-- SECURITY FIX #7 (HIGH/MED) — stop anon overwriting app-behaviour config
-- ============================================================================
-- THE HOLE: 7 config tables are RLS OFF with anon INSERT/UPDATE/DELETE granted,
-- so any holder of the public key can OVERWRITE the app's tuning/config:
--   algorithm_config, app_config, gamification_config, phase_prompts,
--   practice_prompts, presentation_templates, evolution_levels
--
-- VERIFIED 2026-06-09 (both repos):
--   * algorithm_config is the ONLY one read on an anon/logged-out path —
--     useAlgorithmConfig.ts:258 (.from('algorithm_config')) runs for GUESTS
--     (incl. the Dublin cold-beginner demo). So anon SELECT MUST be kept, but
--     anon WRITE removed. The dormant policies in migration 003 already encode
--     public-read + service-write; we activate them.
--   * The other 6 have NO anon path at all — read only by Popty/analytics
--     SERVICE-role server code (api/algorithm-config.js, pod-sync.cjs,
--     orchestrator.cjs, phase8-audio-v13.cjs) and definer RPCs. Full anon lockout.
--   * The ONLY intended writer of algorithm_config is the popty-JWT-gated,
--     service-role PATCH api/algorithm-config.js:54 — unaffected by anon REVOKE.
--
-- TRAP (do NOT do): revoking anon SELECT on algorithm_config silently drops DB
-- tuning for every guest (player falls back to baked DEFAULT_* and fails quiet).

-- --- algorithm_config: keep anon READ, kill anon WRITE ----------------------
REVOKE INSERT, UPDATE, DELETE ON public.algorithm_config FROM anon;
ALTER TABLE public.algorithm_config ENABLE ROW LEVEL SECURITY;
-- activates dormant policies: "Anyone can read algorithm_config" (SELECT, true)
--                             "Service role can write algorithm_config" (ALL, service_role)
-- Keep anon SELECT grant (player needs it logged-out).
GRANT SELECT ON public.algorithm_config TO anon, authenticated;

-- --- the 6 with no anon path: full anon lockout + RLS deny-all --------------
REVOKE ALL ON public.app_config             FROM anon;
REVOKE ALL ON public.gamification_config    FROM anon;
REVOKE ALL ON public.phase_prompts          FROM anon;
REVOKE ALL ON public.practice_prompts       FROM anon;
REVOKE ALL ON public.presentation_templates FROM anon;
REVOKE ALL ON public.evolution_levels       FROM anon;

ALTER TABLE public.app_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamification_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase_prompts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_prompts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_levels       ENABLE ROW LEVEL SECURITY;

-- gamification_config + evolution_levels are read by definer RPCs
-- (get_gamification_config etc.) which run as their owner and bypass RLS, so
-- the analytics/gamification surface is unaffected. service-role bypasses RLS.
-- No anon/authenticated policy is added: with RLS on + zero policies they are
-- deny-all to the public key, which is the goal.

NOTIFY pgrst, 'reload schema';
