/**
 * podLapTelemetry.ts — decide, from a learner's own `player_events`, how many
 * LISTENING-POD (Layer-2) laps they actually completed.
 *
 * WHY THIS FILE EXISTS. Job #657 restored seven zeroed pod ratchets by reading
 * each learner's `pod_lap_end` telemetry, and it read it wrongly in two ways
 * at once. On 2026-09-05 that wrote Tom's zho_for_eng counter to 460 when his
 * own listening justified 44, and fransetter's cym_s to 327 on the strength of
 * ONE event. Both defects are cheap to state and were invisible in the
 * summary the script printed, because a big number looks like a lot of
 * listening:
 *
 *   1. IT USED A LABEL AS A COUNT. `laps = Math.max(...podRounds)` — the
 *      highest ROUND NUMBER seen, not how many laps happened. A learner with
 *      one lap labelled round 326 was credited with 326 laps.
 *
 *   2. IT COUNTED LAYER-1 CUPS AS POD LAPS. A Layer-1 "seeds in the cup" lap
 *      is shaped into a PodLap and played down the same path, so it emits
 *      `pod_lap_start` / `pod_lap_end` under the same name — and its
 *      `podRound` field is the MAIN ROUND NUMBER (LearningPlayer.vue, the L1
 *      block: `podRound: completedMainRound`). Tom's 459 and 188 were cups at
 *      main rounds 459 and 188, played on 31 Aug and 31 Jul. Layer 1 shipped
 *      2026-06-03 (76a6af1a) and has no ratchet — it must never move one.
 *
 * The discriminators, in order of strength:
 *   • `payload.isLayer1` — a boolean added 2026-08-31 for exactly this reason.
 *     Authoritative when present.
 *   • Occurred before Layer 1 shipped → it is a pod lap by construction.
 *   • The child `audio_play` rows: a Layer-1 play carries `stage: 0`, a pod
 *     play carries its ladder stage (1..8). So max child stage 0 = Layer 1.
 *   • Otherwise UNKNOWN — and an unknown lap is never counted as a pod lap.
 *     Silence beats a guess that inflates a learner's position.
 */

/** Layer-1 listening cups shipped in 76a6af1a, 2026-06-03 01:13:20 UTC. */
export const LAYER1_SHIPPED_AT = new Date('2026-06-03T01:13:20Z')

export interface PodLapEndPayload {
  podRound?: number | string | null
  isLayer1?: boolean | null
  abortReason?: string | null
  cancelled?: boolean | null
  skippedByUser?: boolean | null
  playsExpected?: number | null
  playsCompleted?: number | null
}

export interface PodLapEndEvent {
  occurredAt: Date
  payload: PodLapEndPayload
  /** Highest `stage` on the child audio_play rows of this lap, or null if the
   *  lap has no stage-bearing children (pre-instrumentation, or read skipped). */
  childMaxStage?: number | null
}

export type LapLayer = 'layer1' | 'pod' | 'unknown'

/** Which layer played this lap. See the discriminator ladder in the header. */
export function lapLayer(event: PodLapEndEvent): LapLayer {
  const flag = event.payload?.isLayer1
  if (flag === true) return 'layer1'
  if (flag === false) return 'pod'
  if (event.occurredAt < LAYER1_SHIPPED_AT) return 'pod'
  const stage = event.childMaxStage
  if (stage == null) return 'unknown'
  return stage === 0 ? 'layer1' : 'pod'
}

/**
 * Did the learner play this lap to the end? `abortReason` only exists from
 * 2026-05-14; before that a lap that was neither cancelled nor skipped ran to
 * completion (the emit site is a `finally` block, so an end event always
 * exists). Cancelled or user-skipped is never completion — `markLapCompleted`
 * is not called for those, so they earned no intake.
 */
export function isCompletedLap(event: PodLapEndEvent): boolean {
  const p = event.payload ?? {}
  if (p.cancelled === true || p.skippedByUser === true) return false
  return p.abortReason == null || p.abortReason === 'completed'
}

export interface PodLapTally {
  /** Lap-end events read. */
  events: number
  /** Completed laps that were genuinely Layer-2 pod laps. THE LAP COUNT. */
  completedPodLaps: number
  /** Completed laps that were Layer-1 cups — excluded, and the #657 defect. */
  completedLayer1Cups: number
  /** Completed laps whose layer could not be established — excluded. */
  completedUnknown: number
  /** Highest podRound label on a completed POD lap. Under the pre-cohort model
   *  podRound ≡ stored + 1, so this is corroborating evidence of the value the
   *  learner's own laps drove the counter to — NOT a lap count, and never the
   *  write target on its own. */
  highestCompletedPodRound: number | null
  /** Distinct podRound labels on completed pod laps, ascending. */
  distinctCompletedPodRounds: number[]
}

export function tallyPodLaps(events: readonly PodLapEndEvent[]): PodLapTally {
  const tally: PodLapTally = {
    events: events.length,
    completedPodLaps: 0,
    completedLayer1Cups: 0,
    completedUnknown: 0,
    highestCompletedPodRound: null,
    distinctCompletedPodRounds: [],
  }
  const rounds = new Set<number>()
  for (const e of events) {
    if (!isCompletedLap(e)) continue
    const layer = lapLayer(e)
    if (layer === 'layer1') {
      tally.completedLayer1Cups++
      continue
    }
    if (layer === 'unknown') {
      tally.completedUnknown++
      continue
    }
    tally.completedPodLaps++
    const pr = Number(e.payload?.podRound)
    if (Number.isFinite(pr)) {
      rounds.add(pr)
      if (tally.highestCompletedPodRound == null || pr > tally.highestCompletedPodRound) {
        tally.highestCompletedPodRound = pr
      }
    }
  }
  tally.distinctCompletedPodRounds = [...rounds].sort((a, b) => a - b)
  return tally
}

/**
 * Replay the ratchet: start at 0 and advance once per completed POD lap,
 * through the cohort partition the course serves today. THE UNIT TRAP —
 * `completed_pod_rounds` stores SENTENCES covered, never laps, so the lap
 * count must be mapped, never written (podCohorts.ts:212).
 *
 * `ratchetAfterLap` is `podRatchetAfterLap` bound to the course's cohorts.
 */
export function replayRatchet(
  completedPodLaps: number,
  ratchetAfterLap: (stored: number) => number,
): number {
  let stored = 0
  for (let lap = 0; lap < completedPodLaps; lap++) stored = ratchetAfterLap(stored)
  return stored
}
