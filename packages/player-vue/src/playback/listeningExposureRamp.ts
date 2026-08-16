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
 *      the step. SUPERSEDED 2026-08-10 as to Easy's SHIPPED NUMBERS ONLY: Easy
 *      used to start at 0.7 and dwell; Tom heard it live and ruled "return the
 *      default listening speed settings to 1.0x on EASY", so both Easy and Fast
 *      now ship a single terminal step at 1.0. The ramp machinery, and the belt
 *      ceiling that composes with it, are unchanged and still DB-retunable.
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
 * WHAT THIS DOES NOT REPLACE: `computeListeningSpeed` in
 * providers/toSimpleRounds.ts, still reachable by config alone
 * (`ListeningModeConfig.speedSource: 'belt'`) and still the path for anything
 * not exposure-ramped. Its belt term is GONE as of 2026-08-16 — listening is
 * never slowed — so that alternative source now also lands on full pace.
 * `beltSpeed` itself is untouched and still governs SPEAKING via
 * `computeCycleSpeed`. The shipped default here is the exposure ramp.
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
 * EASY's shipped ramp — a single terminal step at 1.0, the same shape as
 * Fast's.
 *
 * SUPERSEDED 2026-08-10 (Tom, listening live): "I think we can return the
 * default listening speed settings to 1.0x on EASY, I think we moved them to
 * 0.8x." He heard the slow-down in his own listening and ruled it out. The
 * shipped default for Easy listening is now native pace.
 *
 * WHAT THIS REPLACES — the exposure ramp read literally off Tom's 2026-08-07
 * words ("0.7 the very first time... then it might stay on 0.8 for a few
 * times, then it might go up to one"): `[{0.7,1},{0.8,4},{1.0,null}]`, one
 * exposure at 0.7, four at 0.8, then 1.0 for ever. That reading is superseded,
 * not deleted: the ramp MACHINERY is untouched, and every number here is a DB
 * value (`algorithm_config.easy_mode.listeningSpeedRamp`), so the gentle curve
 * is one Supabase edit away if Tom ever wants it back — no deploy.
 */
export const DEFAULT_EASY_LISTENING_RAMP: ListeningRampStep[] = [
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

/**
 * One rung of a per-mode BELT CEILING table: from `fromSeed` onward (inclusive),
 * a listening clip may not exceed `speed`. Rungs are read in order and the last
 * matching one wins, so the table must be sorted ascending by `fromSeed`
 * (`normalizeBeltCeilings` sorts it, so a DB row need not be).
 */
export interface ListeningBeltCeiling {
  /** First seed number this rung covers. The first rung should be 1. */
  fromSeed: number
  /** Ceiling for that band. Clamped to LISTENING_SPEED_CEILING. */
  speed: number
}

/**
 * EASY's shipped belt ceilings — a single rung at the global ceiling, which is
 * a no-op. Same shape as Fast's.
 *
 * SUPERSEDED 2026-08-10 (Tom): "return the default listening speed settings to
 * 1.0x on EASY." This table was the thing he could actually hear. It was a HARD
 * ceiling the exposure ramp could never climb past, so an early-course Easy
 * learner sat at 0.8× for ever no matter how many times they met a phrase —
 * and `beltCeilingForSeed` returns the first rung for an unknown position, so
 * an unknown position landed on 0.8 too.
 *
 * WHAT THIS REPLACES — Tom's 2026-08-07 23:56Z belt table: "0.8x for
 * white/yellow belt, 0.9x for orange/green, 1.0x for blue and beyond, NEVER
 * above 1.0", i.e. `[{1,0.8},{20,0.9},{80,1.0}]` keyed on the useBeltProgress
 * boundaries. That ruling is superseded by today's. The ceiling MACHINERY is
 * untouched and the table is a DB value
 * (`algorithm_config.easy_mode.listeningBeltCeilings`), so the belt curve is
 * one Supabase edit away — no deploy.
 *
 * `LISTENING_SPEED_CEILING` (1.0) is a separate, still-standing rule — "never
 * more than one" — and is unaffected by any of this.
 */
export const DEFAULT_EASY_BELT_CEILINGS: ListeningBeltCeiling[] = [
  { fromSeed: 1, speed: LISTENING_SPEED_CEILING },
]

/**
 * FAST's shipped belt ceilings — none. "Fast may still start at 1.0 as you
 * built it — this correction is Easy-only" (Tom, 2026-08-07). A single rung at
 * the global ceiling, which is a no-op.
 */
export const DEFAULT_FAST_BELT_CEILINGS: ListeningBeltCeiling[] = [
  { fromSeed: 1, speed: LISTENING_SPEED_CEILING },
]

/**
 * Coerce a belt-ceiling table out of whatever the DB row holds, degrading to
 * `fallback` — the shipped table for that mode. Same degrade-to-GENTLE rule as
 * the ramp: a malformed table must never mean "no ceiling".
 *
 * Per-rung repair: a non-finite or ≤0 speed drops the rung; a speed above the
 * global ceiling is clamped rather than dropped; a non-finite `fromSeed`
 * becomes 1. The result is sorted ascending, so a DB row in any order works.
 */
export function normalizeBeltCeilings(
  table: readonly ListeningBeltCeiling[] | null | undefined,
  fallback: readonly ListeningBeltCeiling[],
): ListeningBeltCeiling[] {
  if (!Array.isArray(table) || table.length === 0) return [...fallback]
  const rungs: ListeningBeltCeiling[] = []
  for (const rung of table) {
    if (!rung || typeof rung.speed !== 'number' || !Number.isFinite(rung.speed) || rung.speed <= 0) continue
    const fromSeed = typeof rung.fromSeed === 'number' && Number.isFinite(rung.fromSeed) && rung.fromSeed > 0
      ? Math.floor(rung.fromSeed)
      : 1
    rungs.push({ fromSeed, speed: Math.min(rung.speed, LISTENING_SPEED_CEILING) })
  }
  if (rungs.length === 0) return [...fallback]
  return rungs.sort((a, b) => a.fromSeed - b.fromSeed)
}

/**
 * The belt ceiling at `seedNumber` — the LEARNER's position, not the replayed
 * phrase's. Tom's wording is learner-centric twice over ("a white-belt
 * LEARNER's ceiling is 0.8x", "the belt speed is always the maximum for that
 * learner"), so a blue-belt learner replaying an early seed is not dragged back
 * to 0.8.
 *
 * Below the first rung, or with an unknown position, returns the FIRST rung's
 * speed — the gentlest, which is the safe default for "we don't know how far
 * along this learner is".
 */
export function beltCeilingForSeed(
  seedNumber: number | null | undefined,
  table: readonly ListeningBeltCeiling[],
): number {
  if (!table.length) return LISTENING_SPEED_CEILING
  const n = typeof seedNumber === 'number' && Number.isFinite(seedNumber) ? Math.floor(seedNumber) : 0
  let ceiling = table[0].speed
  for (const rung of table) {
    if (n >= rung.fromSeed) ceiling = rung.speed
    else break
  }
  return ceiling
}

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
 * play's `playbackSpeed` comes from. Two ramps compose here, and the order is
 * Tom's (2026-08-07 23:56Z):
 *
 *   min( exposure-ramp step , BELT ceiling )  ×  globalSpeed  → clamp at 1.0
 *
 * The BELT ceiling is the maximum for that learner. The exposure ramp is what
 * approaches it FROM BELOW: an early hearing may be slower than the belt speed,
 * and exposure never pushes past it.
 *
 * With the SHIPPED 2026-08-10 defaults both tables are flat at 1.0 for Easy as
 * well as Fast, so neither holds a learner below native pace — the composition
 * below only bites when a DB row reinstates a curve. Before 2026-08-10 a
 * white-belt Easy learner sat under a 0.8 ceiling for ever; that is the
 * slow-down Tom heard and ruled out.
 *
 * Taking the min BEFORE multiplying by globalSpeed is what keeps a slow-recorded
 * course composing correctly: with a configured ramp of 0.7 under a 0.8 belt
 * ceiling, French (globalSpeed 0.95) gives min(0.7, 0.8) × 0.95 = 0.665 on the
 * first hearing and 0.8 × 0.95 = 0.76 thereafter — never 0.8, which would be
 * the course's own pace exceeded.
 *
 * `globalSpeed` can only ever pull the rate DOWN, because of the final clamp.
 * Non-finite or ≤0 is read as 1.0.
 *
 * `ceiling` (the config key) is intersected with the code constant, so a DB row
 * asking for 1.4 gets 1.0. `beltCeiling` is likewise an upper bound only —
 * passing 1.0 (Fast's value) makes this function behave exactly as it did
 * before the belt table existed.
 */
export function resolveListeningSpeed(
  exposure: number,
  ramp: readonly ListeningRampStep[],
  globalSpeed: number = 1.0,
  ceiling: number = LISTENING_SPEED_CEILING,
  beltCeiling: number = LISTENING_SPEED_CEILING,
): number {
  const g = typeof globalSpeed === 'number' && Number.isFinite(globalSpeed) && globalSpeed > 0
    ? globalSpeed
    : 1.0
  const cap = typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling > 0
    ? Math.min(ceiling, LISTENING_SPEED_CEILING)
    : LISTENING_SPEED_CEILING
  const belt = typeof beltCeiling === 'number' && Number.isFinite(beltCeiling) && beltCeiling > 0
    ? Math.min(beltCeiling, LISTENING_SPEED_CEILING)
    : LISTENING_SPEED_CEILING
  const raw = Math.min(rampSpeedForExposure(exposure, ramp), belt) * g
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
