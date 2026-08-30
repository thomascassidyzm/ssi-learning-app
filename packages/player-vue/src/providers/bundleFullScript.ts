/**
 * bundleFullScript — the WHOLE course, built from the bundle already in memory.
 *
 * Bundle-cutover step 6 (design §5; live status in `docs/bundle-cutover-status.md`).
 * Step 5 retired the JIT endpoints for the rounds the learner is playing right
 * now. This retires path (a) — `providers/generateLearningScript.ts`, the
 * 2,046-line client-side walk that re-reads the whole course out of Supabase
 * for a script it has already been handed.
 *
 * WHY IT MATTERED. Measured on the deployed dev build, 2026-08-29
 * (`docs/first-play-wait-measured-2026-08-29.md`): a cold `spa_for_eng` load
 * had the bundle in memory at ~1.9s and still did not give the learner a
 * pressable play button until ~8.7s. In between sat 125 Supabase queries —
 * including thirty one-per-seed `course_practice_phrases` reads — and a 4.7s
 * unbroken block of main-thread JavaScript with nothing on the network. Every
 * byte of that was data the bundle had already delivered.
 *
 * WHY IT IS THE SAME SCRIPT. This does not re-implement anything. It calls the
 * SAME functions the flagged live path already uses for the rounds a learner
 * hears — `@ssi/core`'s `generateScript`, `toBackendCycle`, and
 * `backendCyclesToRounds` / `infPlayCyclesToRounds` — just over the whole
 * round map instead of one page. So the full-course rounds and the tier-3
 * rounds are the same rounds by construction, which is a stronger guarantee
 * than diffing two producers: on a flagged course the queue can no longer
 * disagree with itself depending on which producer filled a slot.
 *
 * MODE NEUTRALITY is preserved (Tom, 2026-08-09 — "the instructions for WHICH
 * cycles get selected/played and HOW MANY TIMES belongs in the player logic,
 * not the cached script data"). The walk is called with every Easy lever off;
 * this path has no levers to turn off, and passes `repeat` through so the
 * caller keeps deciding. One script, both modes.
 */

import type { CourseBundle } from '@ssi/core'
import { generateScript } from '@ssi/core'
import type { Round } from '../playback/SimplePlayer'
import type { BackendCycle } from '../composables/useInstantPlayback'
import {
  ID_ONLY,
  bundleToInfPlayCyclesResponse,
  bundleToRoundMap,
  toBackendCycle,
} from './bundleToBackendCycles'
import { backendCyclesToRounds, infPlayCyclesToRounds } from './backendCyclesToRounds'
import { yieldToEventLoop } from './generateLearningScript'
import type { TargetSpeedConfig } from './toSimpleRounds'
import type { RepeatPhraseCyclesOptions } from './repeatPhraseCycles'

export interface BundleFullScriptOptions {
  /**
   * Revival rounds to emit after the main loop — the same
   * `infinitePlayLookahead` the walk takes. 0 emits the main loop alone.
   */
  infinitePlayLookahead: number
  /** Course target-speed config (`voice_config.target_speed`) — the baked belt ramp. */
  targetSpeed?: TargetSpeedConfig
  /**
   * Cycle-repeat setting. The live instant path passes MODE-NEUTRAL (count 1,
   * no types) and so should every caller here: repetition is a player-runtime
   * decision, not a property of the script.
   */
  repeat?: RepeatPhraseCyclesOptions | null
}

export interface BundleFullScriptResult {
  /** The whole course, main loop first, then the revival tail. */
  rounds: Round[]
  roundCount: number
  cycleCount: number
  /**
   * Main-loop rounds actually emitted — audio-aware, exactly as the walk's
   * `mainLoopRoundCount` is: a LEGO whose cycles are all missing audio is
   * dropped by `backendCyclesToRounds` and does not count. This is the value
   * `liveMainLoopRoundCount` wants.
   */
  mainLoopRoundCount: number
}

/**
 * Build the whole course from an in-memory bundle. Pure, synchronous, no I/O.
 *
 * On a big course this is one pass over the round map rather than ~125
 * Supabase queries; it is still real work on the main thread, so callers that
 * are anywhere near the boot path should run it off the critical path exactly
 * as they ran the walk.
 */
export function bundleFullScript(
  bundle: CourseBundle,
  opts: BundleFullScriptOptions,
): BundleFullScriptResult {
  const roundMap = bundleToRoundMap(bundle)
  const targetSpeed = opts.targetSpeed ?? {}
  const repeat = opts.repeat ?? null

  const mainRounds = roundMap.rounds.length > 0
    ? buildMainLoopRounds(bundle, roundMap, targetSpeed, repeat, roundMap.rounds.length)
    : []

  return assembleResult(bundle, opts, mainRounds, targetSpeed)
}

/** Revival tail + totals. Shared by the sync and sliced builds so the two can
 *  never drift in how the course ends. */
function assembleResult(
  bundle: CourseBundle,
  opts: BundleFullScriptOptions,
  mainRounds: Round[],
  targetSpeed: TargetSpeedConfig,
): BundleFullScriptResult {
  // The revival tail continues from the LAST main-loop round NUMBER, not from
  // the count. Round numbers come from `course_round_index` (`entry.r`), and a
  // LEGO dropped for missing audio leaves a hole — so on a course with any
  // such hole the count is smaller than the last number, and numbering the
  // tail from the count would collide with a real main-loop round.
  const lastMainRoundNumber = mainRounds.length > 0
    ? mainRounds[mainRounds.length - 1].roundNumber
    : bundle.mainLoopCount
  const infRounds = opts.infinitePlayLookahead > 0 && !bundle.previewOnly
    ? infPlayCyclesToRounds(
        bundleToInfPlayCyclesResponse(bundle, 1, opts.infinitePlayLookahead).cycles,
        lastMainRoundNumber,
        targetSpeed,
      )
    : []

  const rounds = [...mainRounds, ...infRounds]
  let cycleCount = 0
  for (const r of rounds) cycleCount += r.cycles.length

  return {
    rounds,
    roundCount: rounds.length,
    cycleCount,
    mainLoopRoundCount: mainRounds.length,
  }
}

/**
 * As `bundleFullScript`, but it gives the main thread back between chunks.
 *
 * WHY THIS EXISTS, measured. Step 6 removed ~50 Supabase queries and all of
 * the walk's re-derivation, and the time to a pressable play button on a cold
 * `spa_for_eng` still went the WRONG WAY — 4.7s median with the walk against
 * 5.7s with the bundle, over five interleaved cold runs each against the same
 * deployment (`?fullscript=walk` is the arm that isolates it). Less total work
 * losing to more is not a paradox: the walk is network-bound, so between its
 * awaits the main thread is free and the boot render lands; `bundleFullScript`
 * is pure and synchronous, so the whole course arrives as ONE un-yielded block
 * sitting exactly where the button would otherwise go live. Split by stage on
 * `tur_for_eng` (840 LEGOs, desktop Node): generateScript ~30ms,
 * toBackendCycle ~25ms, backendCyclesToRounds ~175ms — a browser main thread
 * pays several times that.
 *
 * So this builds the SAME script in `chunkRounds`-sized slices and yields
 * between them. `generateScript` already pages by (`fromLegoId`, `roundLimit`)
 * — that is exactly how the /cycles endpoint has always driven it, and how the
 * step-5 tier-3 path drives it live — so a chunked build is the same output as
 * one call, which `bundleFullScript.test.ts` asserts round-for-round rather
 * than assumes.
 */
export async function bundleFullScriptSliced(
  bundle: CourseBundle,
  opts: BundleFullScriptOptions,
  chunkRounds = 60,
): Promise<BundleFullScriptResult> {
  const roundMap = bundleToRoundMap(bundle)
  const targetSpeed = opts.targetSpeed ?? {}
  const repeat = opts.repeat ?? null

  const mainRounds: Round[] = []
  for (let i = 0; i < roundMap.rounds.length; i += chunkRounds) {
    const slice = { ...roundMap, rounds: roundMap.rounds.slice(i, i + chunkRounds) }
    mainRounds.push(...buildMainLoopRounds(bundle, slice, targetSpeed, repeat, slice.rounds.length))
    await yieldToEventLoop()
  }

  return assembleResult(bundle, opts, mainRounds, targetSpeed)
}

function buildMainLoopRounds(
  bundle: CourseBundle,
  roundMap: ReturnType<typeof bundleToRoundMap>,
  targetSpeed: TargetSpeedConfig,
  repeat: RepeatPhraseCyclesOptions | null,
  roundLimit: number,
): Round[] {
  const isNewByLego = new Map(bundle.legos.map((l) => [l.legoId, l.isNew]))
  const roundIndexByLego = new Map(bundle.roundMap.map((e) => [e.legoId, e.roundIndex]))

  const { rounds: generated } = generateScript({
    bundle,
    position: { mode: 'main', fromLegoId: roundMap.rounds[0].legoId },
    // One round per round-map entry in this slice (the whole main loop when
    // the caller passed the unsliced map).
    roundLimit,
    audioUrl: ID_ONLY,
  })

  const byLego = new Map<string, BackendCycle[]>()
  for (const round of generated) {
    const wire: BackendCycle[] = []
    for (const c of round.cycles) {
      wire.push(toBackendCycle(c, round.legoId, isNewByLego, roundIndexByLego))
    }
    byLego.set(round.legoId, wire)
  }

  return backendCyclesToRounds(
    (legoId) => byLego.get(legoId) ?? [],
    roundMap,
    // Every LEGO is complete here by construction: the generator emitted whole
    // rounds, there is no pagination boundary to be partial at.
    () => true,
    targetSpeed,
    repeat,
  )
}
