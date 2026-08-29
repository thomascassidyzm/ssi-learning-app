/**
 * bundleToBackendCycles — the bootstrap cutover's adapter.
 *
 * Bundle-cutover step 5 (design §5; live status in `docs/bundle-cutover-status.md`).
 * Produces the EXACT wire shapes `useInstantPlayback` already consumes —
 * `RoundMap` and `CyclesResponse` — but computes them from an in-memory
 * `CourseBundle` via the unified `generateScript` (@ssi/core) instead of
 * fetching `/round-map` and `/cycles`.
 *
 * Why re-emit the wire shape rather than hand `Round[]` straight to the
 * player: everything downstream of `useInstantPlayback` (the cycle buffer,
 * partial-LEGO bookkeeping, pagination, `backendCyclesToRounds`' pause maths
 * and Easy-mode overrides, the pod/L1 schedulers in LearningPlayer) is written
 * against `BackendCycle`. Keeping that boundary byte-identical is what makes
 * this cutover flag-reversible and diffable against the live endpoint —
 * `tools/bundle-cutover/parity-cycles.mjs` proves the two agree cycle by
 * cycle. Collapsing the wire shape out is step 6/7 work, not step 5's.
 */

import { generateScript, type Cycle as GeneratedCycle, type CourseBundle } from '@ssi/core'
import type { BackendCycle, CyclesResponse, RoundMap } from '../composables/useInstantPlayback'

/** The wire shape of `GET /infplay-cycles`, as `fetchInfPlayCyclesLive` reads it. */
export interface InfPlayCyclesResponse {
  course_code: string
  version: number
  cycles: BackendCycle[]
  next_inf_round: number
  main_loop_count: number
}

/** The generator emits audio as URLs; passing identity gives us the raw ids
 *  the wire shape carries, with no string surgery. */
const ID_ONLY = (id: string): string => id

export function bundleToRoundMap(bundle: CourseBundle): RoundMap {
  return {
    course_code: bundle.courseCode,
    // `courses.content_version` is text on some courses and integer on others;
    // the round-map's `version` is only ever compared for equality / ordering
    // by the caches, so a numeric coercion with a 0 floor is enough. (The two
    // version stamps collapse into one when round-map.ts is deleted — step 7.)
    version: Number(bundle.contentVersion ?? bundle.version) || 0,
    rounds: bundle.roundMap.map((e) => ({ r: e.roundIndex, legoId: e.legoId, seed: e.seedNumber })),
  }
}

function seedNumberOf(legoId: string): number {
  const m = /^S(\d{4})L\d{2}$/.exec(legoId)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * One generated cycle → one wire cycle. `roundLegoId` is the LEGO whose ROUND
 * the cycle plays in; it differs from `lego_id` only on cross-LEGO spaced
 * review, and that is exactly when the endpoint sets `round_lego_id`.
 */
function toBackendCycle(
  c: GeneratedCycle,
  roundLegoId: string,
  isNewByLego: Map<string, boolean>,
  roundIndexByLego: Map<string, number>,
): BackendCycle {
  const legoId = c.legoId ?? roundLegoId
  const type = c.type === 'review' ? 'spaced_rep' : (c.type as BackendCycle['type'])
  const isReview = type === 'spaced_rep'
  const audio: BackendCycle['audio'] = {}
  // On an intro the generator puts the presentation narration in the prompt
  // slot (falling back to the known clip), which is precisely what
  // `toPlayerCycle` resolves as `presentation_id || known_id`.
  if (c.type === 'intro') {
    if (c.known.audioUrl) audio.presentation_id = c.known.audioUrl
  } else if (c.known.audioUrl) {
    audio.known_id = c.known.audioUrl
  }
  if (c.target.voice1Url) audio.target1_id = c.target.voice1Url
  if (c.target.voice2Url) audio.target2_id = c.target.voice2Url

  return {
    id: c.id,
    type,
    lego_id: legoId,
    ...(isReview && legoId !== roundLegoId ? { round_lego_id: roundLegoId } : {}),
    ...(isReview && roundIndexByLego.has(legoId) ? { review_of: roundIndexByLego.get(legoId)! } : {}),
    seed_number: seedNumberOf(legoId),
    known_text: c.known.text,
    target_text: c.target.text,
    ...(c.target.textNative !== undefined ? { target_text_native: c.target.textNative } : {}),
    ...(c.components ? { components: c.components } : {}),
    ...(c.glossSegments ? { gloss_segments: c.glossSegments } : {}),
    ...(c.decomposition ? { decomposition: c.decomposition } : {}),
    ...(c.displayTiling ? { display_tiling: c.displayTiling } : {}),
    audio,
    durations: {
      ...(typeof c.target1DurationMs === 'number' ? { target1_ms: c.target1DurationMs } : {}),
      ...(typeof c.target2DurationMs === 'number' ? { target2_ms: c.target2DurationMs } : {}),
    },
    is_new: isNewByLego.get(legoId) ?? true,
  }
}

/**
 * Bundle + position → the same payload `GET /cycles?from=…&limit=…` returns.
 *
 * `limit` counts CYCLES, as the endpoint's does, and truncation follows the
 * endpoint's rule exactly: stop at the first cycle that would exceed the
 * limit, and set `next_lego_id` to the LEGO we stopped inside so the next
 * call replays that round from its start (the caller de-dupes by cycle id).
 */
export function bundleToCyclesResponse(
  bundle: CourseBundle,
  fromLegoId: string,
  limit: number,
): CyclesResponse {
  const isNewByLego = new Map(bundle.legos.map((l) => [l.legoId, l.isNew]))
  const roundIndexByLego = new Map(bundle.roundMap.map((e) => [e.legoId, e.roundIndex]))

  // Rounds are ≤23 cycles but often far fewer, so ask for a generous slice and
  // let the cycle-count truncation below decide where the page actually ends.
  const roundLimit = Math.max(1, Math.ceil(limit / 3) + 1)
  const { rounds, next } = generateScript({
    bundle,
    position: { mode: 'main', fromLegoId },
    roundLimit,
    audioUrl: ID_ONLY,
  })

  const cycles: BackendCycle[] = []
  let nextLegoId: string | null = null
  outer: for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i]
    for (const c of round.cycles) {
      if (cycles.length >= limit) {
        nextLegoId = round.legoId
        break outer
      }
      cycles.push(toBackendCycle(c, round.legoId, isNewByLego, roundIndexByLego))
    }
    nextLegoId = i + 1 < rounds.length ? rounds[i + 1].legoId : next.mode === 'main' ? next.legoId : null
  }

  return {
    course_code: bundle.courseCode,
    version: Number(bundle.contentVersion ?? bundle.version) || 0,
    cycles,
    next_lego_id: nextLegoId,
  }
}

/**
 * Bundle + INF PLAY round → the same payload `GET /infplay-cycles` returns.
 *
 * INF PLAY has no round map and no pagination cursor: `limit` counts ROUNDS,
 * and the caller synthesises its own round map from the `inf_round` stamps.
 * So this is a straight projection of the generator's infplay rounds.
 *
 * WHAT PARITY CAN AND CANNOT MEAN HERE. The endpoint is explicitly
 * non-deterministic — "subsequent requests with the SAME from_round may return
 * DIFFERENT cycles ... that's expected for INF PLAY where variety >
 * determinism" — because both the random-USE LEGO sample and the spaced-rep
 * phrase draw are RNG. Two identical calls to the endpoint do not agree with
 * each other, so cycle-for-cycle equality with the generator is not a
 * property either side has. What must match is the SCHEDULE: which LEGOs are
 * reviewed at which offsets, how many cycles a round carries, and that every
 * phrase drawn is a USE phrase of the LEGO it is filed under. That is what
 * `tools/bundle-cutover/parity-infplay.mjs` checks, and it is checked over
 * repeated endpoint samples so the RNG cannot flatter either side.
 */
export function bundleToInfPlayCyclesResponse(
  bundle: CourseBundle,
  fromRound: number,
  roundLimit: number,
): InfPlayCyclesResponse {
  const isNewByLego = new Map(bundle.legos.map((l) => [l.legoId, l.isNew]))
  const roundIndexByLego = new Map(bundle.roundMap.map((e) => [e.legoId, e.roundIndex]))

  const { rounds } = generateScript({
    bundle,
    position: { mode: 'infplay', fromInfRound: fromRound },
    roundLimit,
    audioUrl: ID_ONLY,
  })

  const cycles: BackendCycle[] = []
  for (const round of rounds) {
    // The generator numbers an infplay round absolutely (mainLoopCount +
    // infRound); the wire carries the infplay-relative number, which is what
    // `bootstrapInfPlay` reads to build its synthetic round map.
    const infRound = round.roundNumber - bundle.mainLoopCount
    for (const c of round.cycles) {
      const wire = toBackendCycle(c, round.legoId, isNewByLego, roundIndexByLego)
      // `review_of` is a MAIN-LOOP round pointer; infplay reviews reach back
      // into the main loop by offset and the endpoint sets no such field.
      delete (wire as { review_of?: number }).review_of
      delete (wire as { round_lego_id?: string }).round_lego_id
      cycles.push({ ...wire, inf_round: infRound })
    }
  }

  return {
    course_code: bundle.courseCode,
    version: Number(bundle.contentVersion ?? bundle.version) || 0,
    cycles,
    next_inf_round: fromRound + roundLimit,
    main_loop_count: bundle.mainLoopCount,
  }
}
