/**
 * The regression test for the #657 counting defect (job #706).
 *
 * The shape that must never come back: Tom's zho_for_eng telemetry, where a
 * Layer-1 cup at MAIN ROUND 459 sat in the same `pod_lap_end` stream as his
 * pod laps, and the derivation read `max(podRound)` as a lap count — writing
 * 460 to a counter his listening justified at 44.
 */
import { describe, it, expect } from 'vitest'
import {
  lapLayer,
  isCompletedLap,
  tallyPodLaps,
  replayRatchet,
  type PodLapEndEvent,
} from './podLapTelemetry'

const at = (iso: string) => new Date(iso)

const lap = (
  iso: string,
  payload: PodLapEndEvent['payload'],
  childMaxStage?: number | null,
): PodLapEndEvent => ({ occurredAt: at(iso), payload, childMaxStage })

describe('lapLayer', () => {
  it('trusts the isLayer1 flag when it is present', () => {
    expect(lapLayer(lap('2026-09-06T12:50:00Z', { podRound: 305, isLayer1: true }, 0))).toBe('layer1')
    expect(lapLayer(lap('2026-09-06T12:42:00Z', { podRound: 460, isLayer1: false }, 8))).toBe('pod')
  })

  it('reads a lap from before Layer 1 shipped as a pod lap', () => {
    expect(lapLayer(lap('2026-05-15T05:11:00Z', { podRound: 26 }))).toBe('pod')
  })

  it('falls back to the child audio_play stage — stage 0 is a Layer-1 cup', () => {
    expect(lapLayer(lap('2026-08-31T09:58:00Z', { podRound: 459 }, 0))).toBe('layer1')
    expect(lapLayer(lap('2026-06-10T11:47:00Z', { podRound: 43 }, 8))).toBe('pod')
  })

  it('says unknown rather than guessing when nothing discriminates', () => {
    expect(lapLayer(lap('2026-07-31T00:51:00Z', { podRound: 188 }, null))).toBe('unknown')
  })
})

describe('isCompletedLap', () => {
  it('counts a pre-abortReason lap that was neither cancelled nor skipped', () => {
    expect(isCompletedLap(lap('2026-05-08T15:52:00Z', { podRound: 19 }))).toBe(true)
  })
  it('never counts a cancelled or user-skipped lap', () => {
    expect(isCompletedLap(lap('2026-06-03T03:03:00Z', { podRound: 34, abortReason: 'cancelled', cancelled: true }))).toBe(false)
    expect(isCompletedLap(lap('2026-05-15T00:43:00Z', { podRound: 25, skippedByUser: true, cancelled: true }))).toBe(false)
  })
})

describe('THE #657 DEFECT — a label is not a count', () => {
  // Tom / zho_for_eng, 2026-09-05. Eleven completed pod laps, plus the two
  // Layer-1 cups whose podRound is the main round he had reached.
  const tomsStream: PodLapEndEvent[] = [
    ...Array.from({ length: 11 }, (_, i) =>
      lap(`2026-06-0${(i % 8) + 1}T12:00:00Z`, { podRound: 33 + i, abortReason: 'completed' }, 8),
    ),
    lap('2026-07-31T00:51:00Z', { podRound: 188, abortReason: 'completed' }, 0), // L1 cup, main round 188
    lap('2026-08-31T09:58:00Z', { podRound: 459, abortReason: 'completed' }, 0), // L1 cup, main round 459
  ]

  it('does not turn one Layer-1 cup at main round 459 into 459 laps', () => {
    const tally = tallyPodLaps(tomsStream)
    expect(tally.completedPodLaps).toBe(11)
    expect(tally.completedLayer1Cups).toBe(2)
    // The old derivation was Math.max(...podRounds) over ALL completed events.
    const oldWay = Math.max(...tomsStream.map((e) => Number(e.payload.podRound)))
    expect(oldWay).toBe(459)
    expect(tally.completedPodLaps).toBeLessThan(oldWay)
    // …and the highest POD round is 43, not 459: the cups are out of the max too.
    expect(tally.highestCompletedPodRound).toBe(43)
  })

  it('fransetter: one completed cup labelled round 326 is one cup, not 326 laps', () => {
    const tally = tallyPodLaps([lap('2026-08-22T10:00:00Z', { podRound: 326, abortReason: 'completed' }, 0)])
    expect(tally.completedPodLaps).toBe(0)
    expect(tally.completedLayer1Cups).toBe(1)
  })

  it('beunollyn stays right: three real pod laps replay to 4 sentences covered', () => {
    // deu_for_eng cohorts: cold-start pair then one sentence a lap.
    const ratchetAfterLap = (stored: number) => (stored === 0 ? 2 : stored + 1)
    const tally = tallyPodLaps([
      lap('2026-08-01T10:00:00Z', { podRound: 1, abortReason: 'completed' }, 1),
      lap('2026-08-02T10:00:00Z', { podRound: 2, abortReason: 'completed' }, 2),
      lap('2026-08-03T10:00:00Z', { podRound: 3, abortReason: 'completed' }, 2),
    ])
    expect(tally.completedPodLaps).toBe(3)
    expect(replayRatchet(tally.completedPodLaps, ratchetAfterLap)).toBe(4)
  })
})

describe('replayRatchet respects the unit trap', () => {
  it('never writes the lap count itself when a cold-start pair is in play', () => {
    const ratchetAfterLap = (stored: number) => (stored === 0 ? 2 : stored + 1)
    expect(replayRatchet(43, ratchetAfterLap)).toBe(44)
    expect(replayRatchet(0, ratchetAfterLap)).toBe(0)
  })
})
