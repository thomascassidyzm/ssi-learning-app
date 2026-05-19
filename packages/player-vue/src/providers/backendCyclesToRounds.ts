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
 *   - pauseDuration is baked here using the same DEFAULT_NORMAL fallback
 *     as `toSimpleRounds` — runtime overrides recompute it from live
 *     algorithm_config at play time, so this fallback is only seen by
 *     environments without live config
 *   - listening / pod / component_intro cycles are NOT emitted: the
 *     backend doesn't return them today (see INSTANT_PLAYBACK_SPEC.md
 *     §"Open questions"). Round-end listening fires via the existing
 *     `simplePlayer.onRoundCompleted` → `podScheduler` path which only
 *     needs round transitions to land — it doesn't depend on listening
 *     cycles being woven into the round itself
 */
import type { Round, Cycle } from '../playback/SimplePlayer'
import type { BackendCycle, RoundMap } from '../composables/useInstantPlayback'
import { computePauseDuration } from '../playback/computePauseDuration'
import { DEFAULT_NORMAL } from '../composables/useAlgorithmConfig'

/** Same audio-URL builder pattern as `toSimpleRounds`. */
const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return `/api/audio/${uuid}`
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
): Round[] {
  const rounds: Round[] = []

  for (const entry of roundMap.rounds) {
    const legoCycles = getCyclesFor(entry.legoId)
    // No cycles fetched yet for this LEGO — it'll come in via tier 3 /
    // near-edge top-up later. Skip silently; appendRounds() handles
    // insertion-order when it lands.
    if (!legoCycles || legoCycles.length === 0) continue

    // The intro cycle (if present) carries the canonical LEGO text +
    // components. Fall back to the first cycle for legacy shape.
    const introCycle = legoCycles.find((c) => c.type === 'intro') ?? legoCycles[0]

    const cycles: Cycle[] = []
    for (const bc of legoCycles) {
      const cycle = toPlayerCycle(bc)
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
      cycles,
    })
  }

  // `roundMap.rounds` is already sorted by round_index, so the rounds
  // array is in script order. No explicit sort needed.
  return rounds
}

/**
 * Convert one `BackendCycle` to the player's `Cycle`. Returns null if
 * the cycle is structurally unplayable (missing all target audio
 * — same skip-policy as `toSimpleRounds`).
 *
 * The backend emits `intro | debut | build | use` today; `listening`
 * is reserved for a future endpoint extension and is handled here
 * defensively so when it lands we don't have to change the adapter.
 */
function toPlayerCycle(bc: BackendCycle): Cycle | null {
  const isIntro = bc.type === 'intro'
  const isListening = bc.type === 'listening'

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

  // No belt-ramp / per-context speed here — the legacy `toSimpleRounds`
  // computes a context-aware speed multiplier. For the cutover we keep
  // it simple: rely on the runtime overrides in `simplePlayer.setRuntimeOverrides`
  // to apply the same belt/context curves at play time. That keeps this
  // adapter pure (no `props.course.voice_config` plumbing).

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
          DEFAULT_NORMAL,
        ),
    // Linger after voice2 on intros so the learner can read the reveal.
    ...(isIntro ? { lingerMs: 2000 } : {}),
    // Raw target durations exposed so runtime overrides (Turbo) can
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
  }

  return cycle
}
