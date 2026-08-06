/**
 * computePauseDuration — single source of truth for the pause length between
 * voice2 of one cycle and the learner-speak window of the next.
 *
 * MODEL (boot + assembly, 2026-06-30) — replaces the older boot/knee/two-rate
 * curve. The gap is two physically distinct things that behave differently:
 *
 *   • BOOT     — the fixed reaction / spin-up before you can produce anything.
 *                Length-independent. Short phrases are almost ALL boot. Shrinks
 *                a LOT as the learner advances (a green belt boots faster).
 *   • ASSEMBLY — piecing the parts together, glancing at the screen, holding it
 *                in working memory. Grows FASTER than linearly with phrase
 *                length (a long phrase isn't 2× a short one — you juggle more
 *                pieces). Shrinks only a LITTLE with belt — a genuinely long
 *                phrase needs assembly time no matter how good you are.
 *
 *   ref      = reference==='avg'     ? (t1+t2)/2
 *            : reference==='target1' ?  t1
 *            :                          t1 + t2          ('sum')
 *              — the NATIVE clip duration(s); the belt effect is explicit below,
 *                NOT baked into the reference via playback speed.
 *   over     = max(0, ref − assembly_threshold_ms)
 *   assembly = assembly_lin·over + assembly_quad·(over/1000)²
 *   p        = belt progress 0(White)→1(Green), from the target playback speed
 *   pause    = clamp(min, max,
 *                    boot·lerp(1, belt_boot, p) + assembly·lerp(1, belt_assembly, p))
 *
 * The two belt knobs split the belt taper: `pause_belt_boot` shrinks the boot
 * (short phrases) hard, `pause_belt_assembly` shrinks assembly (long phrases)
 * gently — so the gap shortens MORE for short phrases than long ones as the
 * learner climbs, which the old single-speed-ramp model could not express.
 * White anchors at 1.0 (no taper); Green is the configured endpoint; Yellow /
 * Orange interpolate by the belt's speed position.
 *
 * BACKWARD COMPAT: when the new assembly knobs are absent the helper falls back
 * to the legacy boot/knee/two-rate curve (knee absent ⇒ Infinity, tail ⇒
 * multiplier, reference ⇒ 'sum'), so any config row predating the new model is
 * unaffected until it carries the new fields.
 *
 * MUST stay in lockstep with the dashboard mirror
 *   ssi-dashboard-v7-clean/src/views/admin/pauseModel.js
 * which powers the Pause Lab preview.
 *
 * The parameters live on a ModeConfig row in the `algorithm_config` table
 * (`easy_mode` and `fast_mode`) so an admin can tune them via the dashboard
 * without a redeploy. Both the SimplePlayer's `setTimeout` and the on-screen
 * countdown ring call into this helper, so admin tweaks affect the visible
 * countdown AND the actual gap in lockstep.
 */
export interface PauseModeConfig {
  pause_base_ms: number
  pause_multiplier: number
  min_pause_ms: number
  max_pause_ms: number
  /** Reference duration the pause scales with (default 'sum' = legacy t1+t2). */
  pause_reference?: 'avg' | 'target1' | 'sum'
  /** LEGACY knee model — reference (ms) past which the gentler tail applies. */
  pause_knee_ms?: number
  /** LEGACY knee model — slope beyond the knee (default = pause_multiplier). */
  pause_tail_multiplier?: number
  /** Boot / reaction floor (ms) — length-independent spin-up. */
  pause_boot_ms?: number
  /** Reference (ms) below which there is no assembly cost (short = pure boot). */
  pause_assembly_threshold_ms?: number
  /** Linear assembly per ms of reference past the threshold. */
  pause_assembly_lin?: number
  /** Quadratic assembly (ms per second² past the threshold) — the super-linear
   *  long-phrase cost. 0 ⇒ a straight assembly ramp. */
  pause_assembly_quad?: number
  /** Boot multiplier at Green belt (White=1.0; interpolated between). <1 shrinks
   *  short-phrase gaps as the learner advances. */
  pause_belt_boot?: number
  /** Assembly multiplier at Green belt (White=1.0). Keep nearer 1.0 than
   *  belt_boot so long phrases shorten less than short ones across belts. */
  pause_belt_assembly?: number
}

/**
 * Fallback pause config for callers that don't inject one — numerically
 * identical to `player-vue`'s `useAlgorithmConfig.DEFAULT_NORMAL` (White-belt
 * curve). Duplicated here rather than imported so `@ssi/core` stays
 * framework-free (bundle-cutover Phase 1, docs/bundle-cutover-design.md §3) —
 * keep the two literal in sync by hand until script-shape wiring lets the
 * bundle carry this instead of a generator-side default.
 */
export const DEFAULT_PAUSE_CONFIG: PauseModeConfig = {
  pause_reference: 'avg',
  pause_boot_ms: 1000,
  pause_assembly_threshold_ms: 1000,
  pause_assembly_lin: 2.5,
  pause_assembly_quad: 0,
  pause_belt_boot: 1.0,
  pause_belt_assembly: 0.8,
  pause_base_ms: 0,
  pause_multiplier: 1.05,
  min_pause_ms: 700,
  max_pause_ms: 15000,
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

/** Belt progress 0(White)→1(Green) from the target playback speed ramp
 *  (White 0.8× … Green 1.0×). Clamped, so non-ramp callers (speed 1) read as
 *  Green and out-of-range speeds saturate. */
function beltProgress(speed: number): number {
  const p = (speed - 0.8) / (1.0 - 0.8)
  return p < 0 ? 0 : p > 1 ? 1 : p
}

export function computePauseDuration(
  target1Ms: number,
  target2Ms: number,
  cfg: PauseModeConfig,
  /** Target-voice playback speed (belt ramp). Drives the belt taper: early
   *  belts (slower speed) get the full boot/assembly, Green gets the configured
   *  endpoint multipliers. Default 1 = Green (no caller-side ramp). */
  playbackSpeed = 1,
): number {
  const spd = playbackSpeed || 1

  // New boot + assembly model (present ⇒ use it).
  if (cfg.pause_assembly_lin != null || cfg.pause_boot_ms != null) {
    const ref = Math.max(0, referenceMs(target1Ms, target2Ms, cfg))
    const boot = cfg.pause_boot_ms ?? 0
    const thr = cfg.pause_assembly_threshold_ms ?? 0
    const lin = cfg.pause_assembly_lin ?? 0
    const quad = cfg.pause_assembly_quad ?? 0
    const over = Math.max(0, ref - thr)
    const overSec = over / 1000
    const assembly = lin * over + quad * overSec * overSec
    const p = beltProgress(spd)
    const bBoot = 1 + p * ((cfg.pause_belt_boot ?? 1) - 1)
    const bAsm = 1 + p * ((cfg.pause_belt_assembly ?? 1) - 1)
    const calc = boot * bBoot + assembly * bAsm
    return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, Math.round(calc)))
  }

  // Legacy knee / two-rate model — belt rides the reference (clip / speed).
  const ref = Math.max(0, referenceMs(target1Ms / spd, target2Ms / spd, cfg))
  const mult = cfg.pause_multiplier ?? 0
  const knee = cfg.pause_knee_ms == null ? Infinity : cfg.pause_knee_ms
  const tail = cfg.pause_tail_multiplier == null ? mult : cfg.pause_tail_multiplier
  const shaped = Math.min(ref, knee) * mult + Math.max(0, ref - knee) * tail
  const calc = cfg.pause_base_ms + shaped
  return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, Math.round(calc)))
}
