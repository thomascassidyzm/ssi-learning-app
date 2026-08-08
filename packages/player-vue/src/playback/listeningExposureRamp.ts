/**
 * listeningExposureRamp.ts — THE one place listening's speed and play pattern
 * are decided (Tom, 2026-08-07).
 *
 * The redesign, verbatim: "I think we've simplified this completely. To just...
 * One mode, which is just... Every single phrase. It's played Target, Known,
 * Target, Target. And I think that's all that happens, and the target None,
 * Target, Target, it's all at... The same speed, so it might be 0.8. Or maybe
 * even Notepoint. Seven, the very first time, and it might be 0.8, then it
 * might stay on 0.8 for a few times, then it might go up to one, never more
 * than one, depending on what mode we're in. Fast can probably start at the
 * regular speed."
 *
 * Four rules follow, and this module owns all four:
 *
 *   1. ONE PATTERN — every listening phrase plays target · known · target ·
 *      target. There are no stages and no per-stage variation. The pattern is
 *      itself a config value (`ListeningModeConfig.playPattern`), so it is
 *      retunable from the DB row rather than by deploy.
 *   2. ONE SPEED PER PHRASE — all four slots of a phrase carry the SAME rate,
 *      including the known-language slot. This is the change from the previous
 *      design, where the known clip was pinned at 1.0× while the target clips
 *      rode a ramp.
 *   3. THE RAMP IS OVER EXPOSURES, not belts — a phrase's Nth hearing picks
 *      the step. Easy starts at 0.7 and dwells; Fast starts at 1.0.
 *   4. 1.0 IS A HARD CEILING — `LISTENING_SPEED_CEILING`. No config value, no
 *      course globalSpeed, no ramp step can put a listening clip above it. The
 *      clamp is in code (`resolveListeningSpeed`), NOT merely in the default
 *      config values, because the configs are live DB rows that override the
 *      code defaults at runtime.
 *
 * WHAT THIS REPLACES: the nine-stage pod playlist (`DEFAULT_PODS.stagePlaylist`,
 * `['ps08x','explainer','ps08x'] … ['ps2x']`) which produced today's staged
 * progression and the 1.5×/2.0× speed-up reps. Retired — see
 * `resolveListeningPattern` and usePodLapScheduler's `resolveStageConfig`.
 *
 * WHAT THIS DOES NOT REPLACE: `computeListeningSpeed` / `beltSpeed` in
 * providers/toSimpleRounds.ts — the BELT curve (0.8 white → 0.9 yellow → 0.95
 * orange → 1.0 green) Tom ruled on 2026-08-06. That is a ramp over a different
 * axis and Tom has not said which wins, so it is kept intact, kept tested, and
 * kept reachable by config alone (`ListeningModeConfig.speedSource: 'belt'`).
 * The shipped default is the exposure ramp.
 */

/**
 * One step of a per-mode exposure ramp: play this many exposures of a phrase at
 * this speed, then move to the next step. `plays: null` (or absent) means "and
 * for ever after" — the terminal step. A ramp's last step SHOULD be terminal;
 * `rampSpeedForExposure` treats the last step as terminal regardless, so a
 * badly-authored DB row degrades to holding the final speed rather than
 * falling off the end.
 */
export interface ListeningRampStep {
  /** Playback rate for this step, before the course globalSpeed and the clamp. */
  speed: number
  /** How many exposures this step covers. null/absent ⇒ terminal (for ever). */
  plays?: number | null
}

/**
 * One slot of the listening play pattern, in layer-neutral vocabulary. Each
 * listening layer maps these onto its own audio:
 *
 *   Layer 1 (seed sandwiches)  target → t1,  known → known clip, target2 → t2
 *   Layer 2 (pod sentences)    target → ps,  known → trans,      target2 → ps
 *
 * `target2` exists only so a seed with two recorded voices uses both; where
 * there is one clip it is the same audio as `target`.
 */
export type ListeningSlot = 'target' | 'known' | 'target2'

/**
 * THE pattern (Tom, 2026-08-07): "Every single phrase. It's played Target,
 * Known, Target, Target." Four slots, no fifth, no per-stage variation. The
 * second target uses voice 2 where the phrase has one — that is a voice
 * choice, not a pattern change, and it is what the pre-existing Layer-1
 * sandwich already did.
 */
export const DEFAULT_LISTENING_PATTERN: ListeningSlot[] = ['target', 'known', 'target2', 'target']

/**
 * The absolute ceiling on any listening playback rate — "never more than one"
 * (Tom, 2026-08-07). This is a code constant and the clamp in
 * `resolveListeningSpeed` is unconditional, so a DB row carrying a ramp step
 * of 1.5, or a course whose globalSpeed is above 1.0, still cannot make a
 * listening clip play fast. Speaking mode is unaffected — it has its own
 * curve (computeCycleSpeed) and its own 2× reps.
 */
export const LISTENING_SPEED_CEILING = 1.0

/**
 * EASY's shipped ramp — Tom's numbers, read literally: "0.7 the very first
 * time, and it might be 0.8, then it might stay on 0.8 for a few times, then
 * it might go up to one".
 *
 * So: one exposure at 0.7, four at 0.8 ("a few times"), then 1.0 for ever.
 * A phrase reaches full speed on its sixth hearing. Every number here is a DB
 * value (`algorithm_config.easy_mode.listeningSpeedRamp`) — retuning by ear is
 * a Supabase edit, not a deploy.
 */
export const DEFAULT_EASY_LISTENING_RAMP: ListeningRampStep[] = [
  { speed: 0.7, plays: 1 },
  { speed: 0.8, plays: 4 },
  { speed: 1.0, plays: null },
]

/**
 * FAST's shipped ramp — "Fast can probably start at the regular speed,
 * probably, yeah, that's probably enough for now" (Tom, 2026-08-07). One
 * terminal step at 1.0: no ramp at all, which is also the ceiling, so Fast
 * listening is flat native pace modulated only by the course globalSpeed.
 */
export const DEFAULT_FAST_LISTENING_RAMP: ListeningRampStep[] = [
  { speed: 1.0, plays: null },
]

/** Which axis decides a listening clip's speed. See the module header. */
export type ListeningSpeedSource = 'exposure' | 'belt'

/** Shipped default: the per-mode exposure ramp (Tom's 2026-08-07 spec). */
export const DEFAULT_LISTENING_SPEED_SOURCE: ListeningSpeedSource = 'exposure'

/**
 * Coerce a ramp out of whatever the DB row holds. Degrades to `fallback` — the
 * shipped ramp for that mode — rather than to something permissive, because a
 * malformed ramp must never mean "no ramp" (that would hand a beginner full
 * speed, the exact bug this redesign exists to fix).
 *
 * Per-step repair, in order:
 *   • a non-finite or ≤0 speed is dropped (a step at 0× is silence);
 *   • a speed above the ceiling is CLAMPED to the ceiling, not dropped — an
 *     admin who types 1.5 gets 1.0, which is the rule, not an error;
 *   • a non-finite or ≤0 `plays` becomes terminal (null), so the step holds.
 * If nothing survives, the fallback is returned whole.
 */
export function normalizeListeningRamp(
  ramp: readonly ListeningRampStep[] | null | undefined,
  fallback: readonly ListeningRampStep[],
): ListeningRampStep[] {
  if (!Array.isArray(ramp) || ramp.length === 0) return [...fallback]
  const steps: ListeningRampStep[] = []
  for (const step of ramp) {
    if (!step || typeof step.speed !== 'number' || !Number.isFinite(step.speed) || step.speed <= 0) continue
    const speed = Math.min(step.speed, LISTENING_SPEED_CEILING)
    const raw = step.plays
    const plays = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null
    steps.push({ speed, plays })
  }
  return steps.length > 0 ? steps : [...fallback]
}

/**
 * The step speed for a phrase's `exposure`-th hearing (1-based). Exposures at
 * or below 1 take the first step; anything past the table's total holds the
 * LAST step's speed for ever, whether or not that step declared itself
 * terminal.
 *
 * Pure and total: an empty ramp yields the ceiling, which is the safe reading
 * of "no ramp configured" for a caller that has already been through
 * normalizeListeningRamp (which never returns empty).
 */
export function rampSpeedForExposure(
  exposure: number,
  ramp: readonly ListeningRampStep[],
): number {
  if (!ramp.length) return LISTENING_SPEED_CEILING
  const n = Number.isFinite(exposure) ? Math.max(1, Math.floor(exposure)) : 1
  let consumed = 0
  for (let i = 0; i < ramp.length; i++) {
    const step = ramp[i]
    const plays = step.plays
    // Terminal step (declared, or simply the last one) holds for ever.
    if (i === ramp.length - 1 || plays == null) return step.speed
    consumed += plays
    if (n <= consumed) return step.speed
  }
  return ramp[ramp.length - 1].speed
}

/**
 * THE listening speed for one phrase's one exposure — what every listening
 * play's `playbackSpeed` comes from.
 *
 *   step speed  ×  the course globalSpeed  →  clamped to LISTENING_SPEED_CEILING
 *
 * `globalSpeed` folds in exactly as it did before this redesign (French ships
 * 0.95, so a French learner's first Easy exposure is 0.7 × 0.95 = 0.665) —
 * a course recorded slow stays slow, and it can only ever pull the rate DOWN
 * because of the clamp. A non-finite or ≤0 globalSpeed is read as 1.0.
 *
 * `ceiling` exists so the ceiling is itself a config key, but it is intersected
 * with the code constant: a DB row asking for 1.4 gets 1.0.
 */
export function resolveListeningSpeed(
  exposure: number,
  ramp: readonly ListeningRampStep[],
  globalSpeed: number = 1.0,
  ceiling: number = LISTENING_SPEED_CEILING,
): number {
  const g = typeof globalSpeed === 'number' && Number.isFinite(globalSpeed) && globalSpeed > 0
    ? globalSpeed
    : 1.0
  const cap = typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling > 0
    ? Math.min(ceiling, LISTENING_SPEED_CEILING)
    : LISTENING_SPEED_CEILING
  const raw = rampSpeedForExposure(exposure, ramp) * g
  // Round to 4dp before clamping so 0.7 × 0.95 lands on 0.665 rather than
  // 0.6649999999999999 — playbackSpeed is compared in tests and logged.
  const rounded = Math.round(raw * 10000) / 10000
  return Math.min(rounded, cap)
}

/**
 * Coerce a saved play pattern into a usable slot list. Unknown slot names are
 * dropped; an empty or absent list degrades to DEFAULT_LISTENING_PATTERN. A
 * pattern is never allowed to end on the known slot — the end-on-target
 * invariant (never strand the learner on their own language, Aran 2026-06-21)
 * is a product rule, not a playlist preference, so a saved ['known'] pattern
 * falls back rather than shipping.
 */
export function resolveListeningPattern(
  pattern: readonly string[] | null | undefined,
): ListeningSlot[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [...DEFAULT_LISTENING_PATTERN]
  const slots = pattern.filter(
    (s): s is ListeningSlot => s === 'target' || s === 'known' || s === 'target2',
  )
  if (slots.length === 0) return [...DEFAULT_LISTENING_PATTERN]
  if (slots[slots.length - 1] === 'known') return [...DEFAULT_LISTENING_PATTERN]
  return slots
}
