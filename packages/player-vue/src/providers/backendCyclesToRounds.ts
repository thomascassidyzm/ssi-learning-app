/**
 * backendCyclesToRounds — Adapter from the instant-playback cycle wire
 * format (`BackendCycle` from `useInstantPlayback`) to the player's
 * existing `Round[]` shape consumed by `simplePlayer.initialize`.
 *
 * This is the cutover-commit twin of `toSimpleRounds.ts`. The legacy
 * path stays: `generateLearningScript → ScriptItem[] → toSimpleRounds → Round[]`.
 * The new path is: `cycles endpoint → BackendCycle[] → backendCyclesToRounds → Round[]`.
 * Both produce the same `Round[]` shape so `SimplePlayer`, the listening
 * orchestration, round-end pod scheduler, belt progress, etc. all keep
 * working unchanged.
 *
 * The adapter is intentionally lean:
 *   - One LEGO == one Round (intros/debuts/builds/uses live in the
 *     cycles array of that LEGO's Round)
 *   - audio URLs are the `/api/audio/<uuid>` proxy paths the SimplePlayer
 *     already consumes
 *   - pauseDuration is baked here using the same DEFAULT_FAST fallback
 *     as `toSimpleRounds` — runtime overrides recompute it from live
 *     algorithm_config at play time, so this fallback is only seen by
 *     environments without live config
 *   - `component_intro` is DROPPED (Tom's ruling, 2026-08-06: "Components
 *     do NOT get introduced"). The cycles endpoint no longer emits it; this
 *     adapter refuses it as a backstop. Components reach the learner only as
 *     visual tiles on the intro/debut cards, never as their own cycle.
 *   - `spaced_rep` cycles (since 2026-08-09) are cross-LEGO: their `lego_id`
 *     names the EARLIER LEGO under review, while `round_lego_id` names the
 *     round they play in. The buffer in `useInstantPlayback` keys on
 *     `round_lego_id ?? lego_id`, so they arrive here already grouped with the
 *     round that scheduled them — the same arrangement `toSimpleRounds` gets
 *     from the walk, where a review item carries the reviewed LEGO's `legoKey`
 *     and the current round's `roundNumber`. They map to the ordinary
 *     four-phase Cycle; the type string is what lets the mode runtime
 *     (adaptationOverrides' spacedRepCap, Easy's cycle repetition) see them
 *   - playbackSpeed is baked here too, via the shared `computeCycleSpeed`
 *     curve from `toSimpleRounds`. It MUST be: the runtime override in
 *     LearningPlayer only ever CANCELS a baked ramp (Easy does), it never
 *     applies one — and the runtime pause override reads
 *     `cycle.playbackSpeed` as its belt proxy. See the note on
 *     `computeCycleSpeed`
 *   - listening / pod cycles are NOT emitted: the backend doesn't return
 *     them today (see INSTANT_PLAYBACK_SPEC.md §"Open questions").
 *     Round-end listening fires via the existing
 *     `simplePlayer.onRoundCompleted` → `podScheduler` path which only
 *     needs round transitions to land — it doesn't depend on listening
 *     cycles being woven into the round itself
 */
import type { Round, Cycle } from '../playback/SimplePlayer'
import type { BackendCycle, RoundMap } from '../composables/useInstantPlayback'
import { computePauseDuration } from '../playback/computePauseDuration'
import { DEFAULT_FAST } from '../composables/useAlgorithmConfig'
import { reportIntroAudioMissing } from '../playback/introAudioTelemetry'
import { computeCycleSpeed, type TargetSpeedConfig } from './toSimpleRounds'
import { capRoundCycles, cyclePromptIdentity } from '../playback/capConsecutiveRepeats'
import { repeatRoundCycles, type RepeatPhraseCyclesOptions } from './repeatPhraseCycles'

/** Same audio-URL builder pattern as `toSimpleRounds`. */
const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return `/api/audio/${uuid}`
}

/**
 * INF PLAY adapter — converts BackendCycles emitted by
 * /api/courses/:code/infplay-cycles into Round[]. Different shape from
 * the main-loop adapter: each Round groups cycles by `inf_round`
 * (multiple LEGOs per round — spaced rep + random USE), not by
 * legoId.
 *
 * The round's nominal legoId is the first cycle's legoId — purely
 * cosmetic, used as a fallback for the runtime cursor when
 * saveRoundProgress doesn't have a lastMainLoopLegoId anchor. The
 * INF PLAY round itself isn't "about" any single LEGO.
 */
export function infPlayCyclesToRounds(
  cycles: BackendCycle[],
  mainLoopCount: number,
  targetSpeed: TargetSpeedConfig = {},
): Round[] {
  const byRound = new Map<number, BackendCycle[]>()
  for (const c of cycles) {
    const r = (c as any).inf_round as number | undefined
    if (typeof r !== 'number') continue
    const list = byRound.get(r)
    if (list) list.push(c)
    else byRound.set(r, [c])
  }
  const rounds: Round[] = []
  for (const [infR, cs] of [...byRound.entries()].sort(([a], [b]) => a - b)) {
    const playerCycles: Cycle[] = []
    for (const bc of cs) {
      const cycle = toPlayerCycle(bc, targetSpeed)
      if (cycle) playerCycles.push(cycle)
    }
    if (playerCycles.length === 0) continue
    const first = cs[0]
    rounds.push({
      roundNumber: mainLoopCount + infR,  // absolute round number, 1-based
      legoId: first.lego_id,
      seedId: `S${String(first.seed_number).padStart(4, '0')}`,
      legoTargetText: '',  // INF PLAY rounds aren't "about" one LEGO
      legoKnownText: '',
      cycles: playerCycles,
    })
  }
  // A-64 floor — see capRoundCycles. INF PLAY rounds come straight off the
  // wire, so this is the only cap they get.
  return capRoundCycles(rounds, cyclePromptIdentity).rounds
}

/**
 * Convert cycles buffered by `useInstantPlayback` into `Round[]`,
 * walking `roundMap` in script order so LEGOs land in the order the
 * spaced-rep math expects.
 *
 * `getCyclesFor(legoId)` is the composable's `getBufferedCyclesForLego`
 * helper — passing it in keeps this function pure and lets the caller
 * pass a different source (e.g. a freshly-prefetched batch) without
 * touching the composable's internal Map.
 *
 * We never look at cycles for legoIds not in `roundMap` (defensive —
 * drift between the map and the cycles endpoint would otherwise produce
 * ghost rounds with no playback position).
 */
export function backendCyclesToRounds(
  getCyclesFor: (legoId: string) => BackendCycle[],
  roundMap: RoundMap,
  /**
   * Predicate: true iff every cycle for `legoId` is in the buffer.
   * Required so a partial-tail LEGO never gets emitted as a truncated
   * Round — SimplePlayer.appendRounds dedupes by roundNumber, so a
   * partial Round becomes permanently stuck at its partial size. The
   * fetch returns 15 cycles regardless of LEGO boundaries; the last
   * LEGO in the window is usually partial (next_lego_id points back
   * at it). Without this gate, that LEGO's USE phrases never play.
   * Defaults to "always complete" for callers that don't track
   * partials (legacy/test paths).
   */
  isLegoComplete: (legoId: string) => boolean = () => true,
  /**
   * Course target-speed config (from `voice_config.target_speed`). Drives the
   * baked belt ramp — see `computeCycleSpeed`. Defaults to `{}` = flat 1.0×,
   * which is what every caller silently got before 2026-08-04 and is exactly
   * the bug this parameter exists to close: pass the real config.
   */
  targetSpeed: TargetSpeedConfig = {},
  /**
   * The active mode's cycle-repeat setting (Tom, 2026-08-07 — Easy plays every
   * practice cycle twice). Omitted, or a count of 1, leaves the rounds exactly
   * as they were, which is Fast. This path is otherwise mode-blind by design,
   * so without it an Easy learner's FIRST rounds — the ones the instant cycles
   * endpoint serves before the full walk lands — would play undoubled, and the
   * doubling would then appear mid-session out of nowhere.
   */
  repeat?: RepeatPhraseCyclesOptions | null,
): Round[] {
  const rounds: Round[] = []

  for (const entry of roundMap.rounds) {
    const legoCycles = getCyclesFor(entry.legoId)
    // No cycles fetched yet for this LEGO — it'll come in via tier 3 /
    // near-edge top-up later. Skip silently; appendRounds() handles
    // insertion-order when it lands.
    if (!legoCycles || legoCycles.length === 0) continue
    // Partial LEGO — wait until the next fetch confirms we're past it
    // before registering the Round. Same insertion-order story applies
    // (later passes will pick it up once complete).
    if (!isLegoComplete(entry.legoId)) continue

    // The intro cycle (if present) carries the canonical LEGO text +
    // components. Fall back to the first cycle for legacy shape.
    const introCycle = legoCycles.find((c) => c.type === 'intro') ?? legoCycles[0]

    const cycles: Cycle[] = []
    for (const bc of legoCycles) {
      // Belt band from the round map's seed — authoritative and always
      // present, unlike the per-cycle `seed_number` on older wire shapes.
      // A review cycle is the exception: it belongs to THIS round but is a
      // phrase from an earlier seed, and the walk speeds it by its OWN seed
      // (toSimpleRounds passes `i.seedId`, the reviewed LEGO's). Use the
      // cycle's own seed there so both producers ramp it identically.
      const isReview = !!bc.round_lego_id && bc.round_lego_id !== bc.lego_id
      const cycle = toPlayerCycle(bc, targetSpeed, isReview ? bc.seed_number : entry.seed)
      if (cycle) cycles.push(cycle)
    }
    if (cycles.length === 0) continue

    rounds.push({
      // roundNumber comes from the materialised round map (1-based per
      // spec — see `useInstantPlayback.RoundMapEntry`). The legacy
      // generator uses the same 1-based convention, so spaced-rep
      // formulas that reference round numbers stay valid.
      roundNumber: entry.r,
      legoId: entry.legoId,
      seedId: `S${String(entry.seed).padStart(4, '0')}`,
      legoTargetText: introCycle.target_text,
      ...(introCycle.target_text_native
        ? { legoTargetTextNative: introCycle.target_text_native }
        : {}),
      legoKnownText: introCycle.known_text,
      // Easy's repetition, on the instant path. Applied before the A-64 floor
      // below, which allows two in a row and so keeps "twice" from becoming
      // three. Without a repeat option this is `cycles` unchanged — Fast.
      cycles: repeat ? repeatRoundCycles(cycles, repeat) : cycles,
    })
  }

  // `roundMap.rounds` is already sorted by round_index, so the rounds
  // array is in script order. No explicit sort needed.
  //
  // A-64 floor (Tom, 2026-08-06). THIS is the instant-playback path that
  // INSTANT_PLAYBACK_ALL makes the live default for every course, and it never
  // touches generateLearningScript — so without this call the law would hold
  // only on the legacy generator path. Applied after the missing-audio skip in
  // toPlayerCycle, which can itself pull two previously separated prompts
  // together.
  return capRoundCycles(rounds, cyclePromptIdentity).rounds
}

/**
 * Convert one `BackendCycle` to the player's `Cycle`. Returns null if
 * the cycle is structurally unplayable (missing all target audio
 * — same skip-policy as `toSimpleRounds`).
 *
 * The backend emits `intro | component_intro | debut | build | spaced_rep |
 * use` today; `listening` is reserved for a future endpoint extension and is
 * handled here defensively so when it lands we don't have to change the
 * adapter. `spaced_rep` needs no special handling: it is an ordinary
 * four-phase production cycle, and the seed-sandwich variant the walk emits at
 * offsets ≥144 is not served by this endpoint.
 *
 * Exported for the INF PLAY adapter (infPlayCyclesToRounds) which
 * reuses the same cycle-shaping logic but groups by inf_round rather
 * than by legoId.
 */
export function toPlayerCycle(
  bc: BackendCycle,
  targetSpeed: TargetSpeedConfig = {},
  /** Seed number for the belt band. Defaults to the cycle's own
   *  `seed_number`; the main-loop adapter passes the round-map's `seed`
   *  instead, which is authoritative and always present. */
  seedNumber: number = bc.seed_number,
): Cycle | null {
  // COMPONENTS ARE NEVER INTRODUCED (Tom, 2026-08-06). The cycles endpoint
  // stopped emitting `component_intro` on that ruling; this is the render-side
  // backstop, so a component introduction cannot reach a learner even if some
  // producer starts emitting one again. Dropping it here is safe: `null` is
  // the adapter's existing "unplayable cycle" return and callers already skip.
  if (bc.type === 'component_intro') return null

  const isIntro = bc.type === 'intro'
  const isListening = bc.type === 'listening'

  // Baked target-voice speed for this cycle's belt band. Drives BOTH the
  // voice speed and (as the belt proxy) the pause taper below.
  const speed = computeCycleSpeed(seedNumber, targetSpeed)

  // Intro uses presentation audio as the prompt ("The X for Y is..."),
  // debut/build/use use the known-language audio.
  const promptAudioId = isIntro
    ? bc.audio.presentation_id || bc.audio.known_id
    : bc.audio.known_id

  // Audio completeness: intros need presentation OR known + target1; all
  // other cycles need known + target1 + target2 to play through all four
  // phases without holes. Missing audio is a backend-data problem we
  // surface by dropping the cycle — the round still plays the rest.
  if (!isListening) {
    if (!isIntro) {
      if (!bc.audio.known_id || !bc.audio.target1_id || !bc.audio.target2_id) {
        return null
      }
    } else {
      // Intro can live with just target voices (no known prompt) — the
      // presentation audio takes the prompt slot. But it must have
      // target voices to do the reveal.
      if (!bc.audio.target1_id || !bc.audio.target2_id) {
        return null
      }
    }
  }

  // An intro with no presentation clip is the silence-class this whole
  // path used to swallow. Report it — degraded (known audio took the
  // prompt) and fully silent (no prompt audio at all) are different
  // severities and are distinguished by `tier`.
  if (isIntro && !bc.audio.presentation_id) {
    reportIntroAudioMissing({
      legoId: bc.lego_id,
      cycleId: bc.id,
      cycleType: bc.type,
      tier: bc.audio.known_id ? 'known_fallback' : 'silent',
      source: 'backend',
    })
  }

  // (Historical note, kept as a warning.) This block used to read:
  //   "No belt-ramp / per-context speed here — rely on the runtime overrides
  //    in simplePlayer.setRuntimeOverrides to apply the same belt/context
  //    curves at play time. That keeps this adapter pure."
  // That assumption was FALSE and cost every learner their belt ramp from the
  // instant-playback cutover until 2026-08-04: the play-time override it named
  // only ever CANCELLED a baked ramp (Easy's did), never applied one. The speed
  // is now baked above, from the course's real `voice_config.target_speed`
  // which the caller threads in as `targetSpeed` — and the override itself is
  // gone (2026-08-07), so this bake is the only speed there is.

  // Decomposition → componentLegoIds / componentLegoTexts. The backend's
  // `decomposition` is per-token (one entry per word, with optional legoId
  // and an isGhost flag for particles); the legacy script generator emits
  // parallel componentLegoIds + componentLegoTexts arrays for non-ghost
  // tokens. Convergence: derive the same arrays here so downstream code
  // (currentPhraseLegoBlocks in LearningPlayer) reads the same shape from
  // both producers.
  const bound = bc.decomposition?.filter((d) => !!d.legoId) ?? []
  const componentLegoIds = bound.length > 0 ? bound.map((d) => d.legoId as string) : undefined
  const componentLegoTexts = bound.length > 0 ? bound.map((d) => d.target) : undefined

  const cycle: Cycle = {
    id: bc.id,
    type: bc.type,
    legoId: bc.lego_id,
    known: {
      text: bc.known_text ?? '',
      audioUrl: audioUrl(promptAudioId),
    },
    target: {
      text: bc.target_text ?? '',
      ...(bc.target_text_native ? { textNative: bc.target_text_native } : {}),
      voice1Url: audioUrl(bc.audio.target1_id),
      voice2Url: audioUrl(bc.audio.target2_id),
    },
    // Intros: no pause (the engine skips the speak phase when
    // pauseDuration === 0 — same convention as `toSimpleRounds`).
    // Other cycles: dynamic pause from the target durations.
    pauseDuration: isIntro
      ? 0
      : computePauseDuration(
          bc.durations.target1_ms ?? 0,
          bc.durations.target2_ms ?? 0,
          DEFAULT_FAST,
          speed,
        ),
    // Linger after voice2 on intros so the learner can read the reveal.
    ...(isIntro ? { lingerMs: 2000 } : {}),
    // Raw target durations exposed so the mode runtime overrides can
    // recompute the pause with their own formula instead of just
    // scaling the baked value. Matches `toSimpleRounds`.
    ...(bc.durations.target1_ms ? { target1DurationMs: bc.durations.target1_ms } : {}),
    ...(bc.durations.target2_ms ? { target2DurationMs: bc.durations.target2_ms } : {}),
    // M-LEGO component breakdown for the per-tile known/target labels.
    // Same field shape as legacy toSimpleRounds.
    ...(bc.components && bc.components.length > 0 ? { components: bc.components } : {}),
    // Native-script variant — backend doesn't emit a separate componentsNative
    // today; fall back to the same array so downstream consumers that
    // prefer native script still get something rather than empty.
    // (Refine when the backend gains a native-script column.)
    ...(bc.components && bc.components.length > 0 ? { componentsNative: bc.components } : {}),
    // Phrase-decomposition parallel arrays — drive multi-tile rendering
    // for USE phrases that reference previously-introduced LEGOs.
    ...(componentLegoIds ? { componentLegoIds } : {}),
    ...(componentLegoTexts ? { componentLegoTexts } : {}),
    // Native-script variant — same fallback rationale as componentsNative.
    ...(componentLegoTexts ? { componentLegoTextsNative: componentLegoTexts } : {}),
    // Authoritative tiling, passed through VERBATIM (not just the derived
    // componentLegoIds) so the player can render it directly — exact LEGO
    // spans, ghost residue, and the anchored salient.
    ...(Array.isArray(bc.decomposition) && bc.decomposition.length > 0 ? { decomposition: bc.decomposition } : {}),
    // Authored display tiles — same verbatim pass-through (wire snake_case →
    // player camelCase, matching toSimpleRounds' displayTiling field).
    ...(Array.isArray(bc.display_tiling) && bc.display_tiling.length > 0 ? { displayTiling: bc.display_tiling } : {}),
    // Baked belt/global speed. Omitted at exactly 1.0 so the wire shape
    // matches `toSimpleRounds` (which also only sets it when != 1.0) and
    // the modes' `target / baked` cancellation reads the same default.
    ...(speed !== 1.0 ? { playbackSpeed: speed } : {}),
  }

  return cycle
}
