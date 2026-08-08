/**
 * A-64 (Tom, 2026-08-06): "no mode should ever repeat the same prompt more than
 * twice consecutively." Listening mode is the loudest breach in the app — a pod
 * whose first cohort holds a single sentence plays that one clip several times
 * per lap, and every lap restarts on it.
 */
import { describe, it, expect } from 'vitest'
import { usePodLapScheduler, type PodLap } from './usePodLapScheduler'
import { findConsecutiveBreach } from '../playback/capConsecutiveRepeats'

interface MockState {
  podSentences: any[]
  bookends: any[]
  enrollment: { pod_activation_round: number | null; completed_pod_rounds: number } | null
  enrollmentUpdates: Array<Record<string, any>>
}

function makeMockSupabase(state: MockState) {
  const builder = (table: string) => {
    let mode: 'select' | 'update' = 'select'
    let updatePayload: any = null
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: () => {
        if (table === 'course_enrollments') {
          return Promise.resolve({ data: state.enrollment, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      update: (payload: any) => {
        mode = 'update'
        updatePayload = payload
        return chain
      },
      then: (cb: any) => {
        if (mode === 'update') {
          state.enrollmentUpdates.push(updatePayload)
          return Promise.resolve({ error: null }).then(cb)
        }
        if (table === 'listening_pod_sentences') {
          return Promise.resolve({ data: state.podSentences, error: null }).then(cb)
        }
        if (table === 'course_audio') {
          return Promise.resolve({ data: state.bookends, error: null }).then(cb)
        }
        if (table === 'learner_pod_state') {
          return Promise.resolve({ data: [], error: null }).then(cb)
        }
        return Promise.resolve({ data: null, error: null }).then(cb)
      },
    }
    return chain
  }
  return { from: builder, schema: () => ({ from: builder }) } as any
}

const podSentence = (i: number) => ({
  global_order: i,
  target_text: `T${i}`,
  known_text: `K${i}`,
  target_audio_id: `tgt-${i}`,
  known_audio_id: `kn-${i}`,
})

const playIdentity = (p: { audioId: string }) => p.audioId

/** Flatten consecutive laps into the sequence the learner actually hears. */
function heardSequence(laps: PodLap[]): Array<{ audioId: string }> {
  const out: Array<{ audioId: string }> = []
  for (const lap of laps) {
    if (lap.intro) out.push({ audioId: lap.intro.id })
    out.push(...lap.plays)
    if (lap.outro) out.push({ audioId: lap.outro.id })
  }
  return out
}

async function runLaps(sentenceCount: number, lapCount: number, withBookends: boolean) {
  const state: MockState = {
    podSentences: Array.from({ length: sentenceCount }, (_, i) => podSentence(i + 1)),
    bookends: withBookends
      ? [
          { role: 'bookend_listen_intro', id: 'intro-1', text: 'Listen', duration_ms: 2000 },
          { role: 'bookend_listen_outro', id: 'outro-1', text: 'Talk', duration_ms: 2000 },
        ]
      : [],
    enrollment: { pod_activation_round: 5, completed_pod_rounds: 0 },
    enrollmentUpdates: [],
  }
  const scheduler = usePodLapScheduler({
    supabase: makeMockSupabase(state),
    courseCode: 'hrv_for_eng',
    learnerId: 'guest-a64',
  })
  await scheduler.initialize()

  const laps: PodLap[] = []
  for (let i = 0; i < lapCount; i++) {
    const lap = scheduler.nextLap()
    if (!lap) break
    laps.push(lap)
    await scheduler.markLapCompleted()
  }
  return laps
}

describe('usePodLapScheduler — A-64 consecutive cap', () => {
  it('a one-sentence pod never plays its single clip three times in a row, within a lap or across laps', async () => {
    const laps = await runLaps(1, 8, false)
    expect(laps.length).toBeGreaterThan(0)
    expect(findConsecutiveBreach(heardSequence(laps), playIdentity)).toBe(-1)
    // Every lap still plays something — the session never stalls.
    for (const lap of laps) expect(lap.plays.length).toBeGreaterThan(0)
  })

  it('a one-sentence pod with bookends is lawful too', async () => {
    const laps = await runLaps(1, 8, true)
    expect(laps.length).toBeGreaterThan(0)
    expect(findConsecutiveBreach(heardSequence(laps), playIdentity)).toBe(-1)
  })

  it('a two-sentence pod is lawful across many laps', async () => {
    const laps = await runLaps(2, 12, false)
    expect(laps.length).toBeGreaterThan(0)
    expect(findConsecutiveBreach(heardSequence(laps), playIdentity)).toBe(-1)
  })

  it('a multi-sentence pod keeps every play — re-interleaving, not dropping', async () => {
    const laps = await runLaps(4, 10, false)
    const seq = heardSequence(laps)
    expect(findConsecutiveBreach(seq, playIdentity)).toBe(-1)
    // With four sentences there is always something to interleave against, so
    // no lap should have lost a play to the cap: each lap keeps at least two
    // plays per active sentence.
    for (const lap of laps) {
      expect(lap.plays.length).toBeGreaterThanOrEqual(2)
    }
  })
})
