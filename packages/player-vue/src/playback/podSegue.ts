/**
 * Pod-round boundary composition — the Layer-1 (seed cup) / Layer-2 (dialogue
 * pod) segue, and what to do when the pod claims a boundary but composes
 * nothing.
 *
 * Extracted from LearningPlayer.vue so the two rules that actually matter here
 * are unit-testable in isolation:
 *
 *  1. POD FIRST (Tom, 2026-09-01): "On a listening round the dialogue pod leads
 *     and the seed drill follows." The seed cup is the part that grows without
 *     limit — measured fleet-wide it went from ~17 clips to ~76, and up to 164
 *     for a heavy French learner: seven to nine minutes of drill before any
 *     dialogue. With the pod trailing, a learner's own history decided whether
 *     they ever reached the dialogue, and anyone who tapped out early never did.
 *     Pod first means the hardest-to-replace piece lands first and the unbounded
 *     part is what gets truncated. Nothing else changes: same plays, same count,
 *     one intro bookend and one outro around the whole block.
 *
 *  2. A POD FAILURE MUST NOT TAKE THE SEED DRILL DOWN WITH IT. The pod claims
 *     the boundary (and the player is pre-paused) before anyone knows whether it
 *     can compose a lap. Until 2026-09-01 a pod that composed nothing produced
 *     no lap, no event and no fallback — Layer 1 having already been stood down
 *     because the pod owned the slot — so the learner got silence on that
 *     boundary and telemetry recorded nothing at all.
 */

import type { PodLap, PodPlay } from '../composables/usePodLapScheduler'
import type { L1Play } from '../composables/useLayer1Scheduler'

/**
 * Shape Layer-1 seed-cup plays into the PodPlay wire format so they can ride
 * the pod playback runtime. `isLayer1` marks them as audio-only — the
 * teleprompter never shows text for them (product rule 2026-07-22).
 */
export const layer1PlaysAsPodPlays = (l1Plays: readonly L1Play[]): PodPlay[] =>
  l1Plays.map((p) => ({
    sentenceIdx: p.seedNumber,
    stage: 0,
    playRole: p.role, // 'ps' | 'trans' — drives the gap matrix + known/target text
    audioId: p.audioId,
    text: p.text,
    playbackSpeed: p.playbackSpeed,
    glueToNextChunk: false,
    isLayer1: true,
  })) as PodPlay[]

/**
 * Segue the round's Layer-1 seed cup into the Layer-2 pod lap as ONE block:
 * single intro bookend → pod → seed drill → single outro bookend.
 *
 * POD FIRST. Passing an empty cup returns the lap untouched.
 */
export const seguePodWithLayer1 = (lap: PodLap, l1Plays: readonly L1Play[]): PodLap => {
  if (!l1Plays.length) return lap
  return { ...lap, plays: [...lap.plays, ...layer1PlaysAsPodPlays(l1Plays)] }
}

/**
 * What the boundary should do once the pod has been asked for a lap.
 *
 *  • `play-lap`      — the pod composed something; play it (with the seed cup
 *                      segued on behind it).
 *  • `preview-resume` — ?pod=1 preview cheat forced this boundary and found
 *                      nothing; undo the speculative pause and try again next
 *                      boundary.
 *  • `fallback-layer1` — real boundary, pod composed nothing: log it and give
 *                      the learner their seed drill rather than silence.
 *  • `resume`        — nothing playable at all; unstick the player.
 */
export type PodBoundaryOutcome = 'play-lap' | 'preview-resume' | 'fallback-layer1' | 'resume'

export const podBoundaryOutcome = (opts: {
  hasLap: boolean
  forcePodPreviewCheat: boolean
  /** Layer-1 scheduler is present, initialised, and this mode runs Layer 1. */
  layer1Available: boolean
}): PodBoundaryOutcome => {
  if (opts.hasLap) return 'play-lap'
  if (opts.forcePodPreviewCheat) return 'preview-resume'
  return opts.layer1Available ? 'fallback-layer1' : 'resume'
}

/**
 * OFFLINE: THE WHOLE POD, OR NO POD.
 *
 * The download side already refuses to call a pod cached until every clip of it
 * is (`fix(offline): the WHOLE pod first, not most of it`, 01b04769). This is
 * the same rule at playback time, and it was missing.
 *
 * A pod-round lap is the dialogue pod with the round's Layer-1 seed cup segued
 * on behind it, and offline the whole thing was filtered to what's on the
 * device as ONE unit. So a learner whose pod audio hadn't been downloaded got
 * the pod plays trimmed away sentence by sentence while the seed plays — older
 * course audio, far more likely to be cached — survived. What played was a
 * listening block that was all seed drill and no dialogue; it ran to
 * completion, so the ratchet bumped, and a pod round they never heard was
 * spent. Nothing recorded that the dialogue had gone missing.
 *
 * That is Tom's report on 2026-09-01, verbatim: "we're ONLY getting the
 * listening SEEDS".
 *
 * So the pod is judged on its own, before the cup is segued on, and a pod that
 * is not wholly on the device does not fire at all: it stays due, and the seed
 * cup runs in its place.
 *
 * Bookends are not part of the judgement — a missing intro/outro chime costs
 * the learner nothing, and `filterLapToDeviceAudio` already drops them safely.
 */
export const podIsWhollyOnDevice = (
  lap: Pick<PodLap, 'plays'> | null | undefined,
  filtered: Pick<PodLap, 'plays'> | null | undefined,
): boolean => {
  if (!lap) return false
  if (!filtered) return false
  return filtered.plays.length === lap.plays.length
}
