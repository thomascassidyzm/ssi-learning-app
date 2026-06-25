/**
 * computePauseDuration — single source of truth for the pause length between
 * voice2 of one cycle and the learner-speak window of the next.
 *
 * Formula (enriched 2026-06-25):
 *   ref    = pause_reference==='avg'     ? (t1+t2)/2
 *          : pause_reference==='target1' ?  t1
 *          :                                t1 + t2          (legacy 'sum' default)
 *   shaped = min(ref, knee)·pause_multiplier
 *          + max(0, ref−knee)·pause_tail_multiplier
 *   pause  = clamp(min_pause_ms, max_pause_ms, pause_base_ms + shaped)
 *
 * The knee lets long sentences stop scaling at the full multiplier (a fixed
 * multiplier on long phrases feels unnatural — the gentler tail multiplier
 * applies beyond the knee). `pause_reference` lets the gap track the single
 * phrase the learner says (target1) or the average of both answer voices,
 * rather than both summed. The three new fields are OPTIONAL — absent ⇒
 * knee Infinity, tail = multiplier, reference 'sum' ⇒ identical to the old
 * linear clamp, so existing algorithm_config rows are unaffected until an
 * admin tunes them in the dashboard's Pause Lab.
 *
 * MUST stay in lockstep with the dashboard mirror
 *   ssi-dashboard-v7-clean/src/views/admin/pauseModel.js
 * which powers the Pause Lab preview.
 *
 * The parameters live on a ModeConfig row in the `algorithm_config` table
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
  /** Reference duration the pause scales with (default 'sum' = legacy t1+t2). */
  pause_reference?: 'avg' | 'target1' | 'sum'
  /** Reference-duration (ms) past which the gentler tail multiplier applies. */
  pause_knee_ms?: number
  /** Slope beyond the knee (default = pause_multiplier ⇒ a straight line). */
  pause_tail_multiplier?: number
}

function referenceMs(t1: number, t2: number, cfg: PauseModeConfig): number {
  const a = t1 || 0
  const b = t2 || 0
  switch (cfg.pause_reference ?? 'sum') {
    case 'target1': return a
    case 'avg': return (a + b) / 2
    default: return a + b
  }
}

export function computePauseDuration(
  target1Ms: number,
  target2Ms: number,
  cfg: PauseModeConfig,
): number {
  const ref = Math.max(0, referenceMs(target1Ms, target2Ms, cfg))
  const mult = cfg.pause_multiplier ?? 0
  const knee = cfg.pause_knee_ms == null ? Infinity : cfg.pause_knee_ms
  const tail = cfg.pause_tail_multiplier == null ? mult : cfg.pause_tail_multiplier
  const shaped = Math.min(ref, knee) * mult + Math.max(0, ref - knee) * tail
  const calc = cfg.pause_base_ms + shaped
  return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, Math.round(calc)))
}
