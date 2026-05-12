/**
 * computePauseDuration — single source of truth for the pause length between
 * voice2 of one cycle and the learner-speak window of the next.
 *
 * Formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (t1 + t2) × pause_multiplier)
 *
 * The four parameters live on a ModeConfig row in the `algorithm_config` table
 * (`normal_mode` and `turbo_boost`) so an admin can tune them via the dashboard
 * without a redeploy. Both the SimplePlayer's `setTimeout` and the on-screen
 * countdown ring call into this helper, so admin tweaks affect the visible
 * countdown AND the actual gap in lockstep.
 *
 * At cycle bake time (toSimpleRounds / scriptItemToCycle) we don't have live
 * algorithm_config in scope, so we use DEFAULT_NORMAL from useAlgorithmConfig
 * as the fallback — same shape, same defaults the DB row would have if it
 * were freshly seeded. The runtime override in LearningPlayer.vue recomputes
 * with the live config, so any admin change wins.
 */
export interface PauseModeConfig {
  pause_base_ms: number
  pause_multiplier: number
  min_pause_ms: number
  max_pause_ms: number
}

export function computePauseDuration(
  target1Ms: number,
  target2Ms: number,
  cfg: PauseModeConfig,
): number {
  const t1 = target1Ms || 0
  const t2 = target2Ms || 0
  const calc = cfg.pause_base_ms + (t1 + t2) * cfg.pause_multiplier
  return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, Math.round(calc)))
}
