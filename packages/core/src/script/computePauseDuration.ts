/**
 * computePauseDuration — single source of truth for the "say it yourself" gap
 * between the prompt and the target voices.
 *
 * MODEL (one formula, 2026-08-29 — Tom's ruling). The gap is the time the
 * learner needs to build and say the TARGET sentence, so it is proportional to
 * how long that sentence takes to say:
 *
 *   answer = (target1Ms + target2Ms) / 2      ← the NATIVE 1.0× clip durations
 *                                               (same sentence, two voices)
 *   gap    = clamp(min, max, k · answer + reaction_ms)
 *
 * Two tunables per mode, and only two:
 *   • pause_k           — the thinking multiplier (how much longer than the
 *                         sentence itself the learner needs to assemble it).
 *   • pause_reaction_ms — the fixed beat before you start, roughly the same
 *                         whatever the sentence.
 *
 * PLAYBACK SPEED IS NOT AN INPUT. It used to be, twice over: the legacy knee
 * path divided the clip durations by the speed, and the boot+assembly path
 * derived a "belt progress" from the target playback speed to taper the gap.
 * Both are gone. The reference is always the native 1.0× duration, and the
 * function takes no speed argument, so Easy (0.8×) can no longer silently
 * inflate the gap and a course-level base speed can no longer shift the curve.
 *
 * `min_pause_ms` / `max_pause_ms` are kept as SAFETY CLAMPS — not tuning; they
 * stop a missing or absurd duration producing a 40-second silence.
 *
 * Legacy fields on a stored config row (pause_base_ms, pause_multiplier,
 * pause_knee_ms, pause_tail_multiplier, pause_boot_ms, pause_assembly_*,
 * pause_belt_*, pause_reference) are IGNORED. There is no legacy branch: a
 * stale `algorithm_config` row cannot resurrect the old curve — it simply falls
 * back to the defaults below until it carries `pause_k` / `pause_reaction_ms`.
 *
 * MUST stay in lockstep with the dashboard mirror
 *   ssi-dashboard-v7-clean/src/views/admin/pauseModel.js
 * which powers the Speaking Lab preview.
 *
 * The parameters live on a ModeConfig row in the `algorithm_config` table
 * (`fast_mode` and `easy_mode`) so an admin can tune them via the dashboard
 * without a redeploy. Both the SimplePlayer's `setTimeout` and the on-screen
 * countdown ring call into this helper, so admin tweaks affect the visible
 * countdown AND the actual gap in lockstep.
 */
export interface PauseModeConfig {
  /** Thinking multiplier on the native target-sentence duration. */
  pause_k?: number
  /** Fixed reaction-time beat (ms) added on top. */
  pause_reaction_ms?: number
  /** Safety floor (ms) — not a tuning knob. */
  min_pause_ms: number
  /** Safety ceiling (ms) — not a tuning knob. */
  max_pause_ms: number
}

/** Fallback used when a config row carries neither tunable. Fast-mode values —
 *  see DEFAULT_PAUSE_K / DEFAULT_PAUSE_REACTION_MS for the rationale. */
export const DEFAULT_PAUSE_K = 2.8
export const DEFAULT_PAUSE_REACTION_MS = 800

/**
 * Fallback pause config for callers that don't inject one — numerically
 * identical to `player-vue`'s `useAlgorithmConfig.DEFAULT_FAST`. Duplicated
 * here rather than imported so `@ssi/core` stays framework-free; keep the two
 * literals in sync by hand.
 */
export const DEFAULT_PAUSE_CONFIG: PauseModeConfig = {
  pause_k: DEFAULT_PAUSE_K,
  pause_reaction_ms: DEFAULT_PAUSE_REACTION_MS,
  min_pause_ms: 1000,
  max_pause_ms: 15000,
}

/**
 * The learner's speaking gap, in ms.
 *
 * @param target1Ms native (1.0×) duration of the target sentence, voice 1
 * @param target2Ms native (1.0×) duration of the same sentence, voice 2
 */
export function computePauseDuration(
  target1Ms: number,
  target2Ms: number,
  cfg: PauseModeConfig,
): number {
  const answer = Math.max(0, ((target1Ms || 0) + (target2Ms || 0)) / 2)
  const k = cfg.pause_k ?? DEFAULT_PAUSE_K
  const reaction = cfg.pause_reaction_ms ?? DEFAULT_PAUSE_REACTION_MS
  const calc = k * answer + reaction
  return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, Math.round(calc)))
}
