import { describe, it, expect } from 'vitest'
import { layer1PlaysAsPodPlays, seguePodWithLayer1, podBoundaryOutcome, podIsWhollyOnDevice } from './podSegue'
import type { PodLap, PodPlay } from '../composables/usePodLapScheduler'
import type { L1Play } from '../composables/useLayer1Scheduler'

const podPlay = (audioId: string, sentenceIdx = 1): PodPlay => ({
  sentenceIdx,
  stage: 1,
  playRole: 'ps',
  audioId,
  text: `pod ${audioId}`,
  playbackSpeed: 1.0,
  glueToNextChunk: false,
}) as PodPlay

const l1Play = (audioId: string, seedNumber = 10): L1Play => ({
  seedNumber,
  audioId,
  text: `seed ${audioId}`,
  role: 'ps',
  playbackSpeed: 1.0,
} as L1Play)

const lapOf = (...plays: PodPlay[]): PodLap => ({
  podRound: 7,
  intro: { id: 'intro-audio', duration_ms: 1000 } as PodLap['intro'],
  plays,
  outro: { id: 'outro-audio', duration_ms: 1000 } as PodLap['outro'],
})

describe('seguePodWithLayer1 — POD FIRST (Tom, 2026-09-01)', () => {
  it('plays the dialogue pod before the seed drill', () => {
    const lap = lapOf(podPlay('pod-a'), podPlay('pod-b'))
    const out = seguePodWithLayer1(lap, [l1Play('seed-a'), l1Play('seed-b')])

    expect(out.plays.map((p) => p.audioId)).toEqual(['pod-a', 'pod-b', 'seed-a', 'seed-b'])
  })

  it('is pod-led even when the seed drill dwarfs the pod (the 164-clip case)', () => {
    const lap = lapOf(...Array.from({ length: 9 }, (_, i) => podPlay(`pod-${i}`)))
    const cup = Array.from({ length: 164 }, (_, i) => l1Play(`seed-${i}`))
    const out = seguePodWithLayer1(lap, cup)

    // First thing the learner hears is dialogue, not drill.
    expect(out.plays[0].audioId).toBe('pod-0')
    expect(out.plays[8].audioId).toBe('pod-8')
    expect(out.plays[9].audioId).toBe('seed-0')
    expect(out.plays).toHaveLength(173)
  })

  it('preserves every play, the counts, and the single pair of bookends', () => {
    const lap = lapOf(podPlay('pod-a'), podPlay('pod-b'))
    const cup = [l1Play('seed-a'), l1Play('seed-b'), l1Play('seed-c')]
    const out = seguePodWithLayer1(lap, cup)

    expect(out.plays).toHaveLength(lap.plays.length + cup.length)
    expect(new Set(out.plays.map((p) => p.audioId)))
      .toEqual(new Set(['pod-a', 'pod-b', 'seed-a', 'seed-b', 'seed-c']))
    expect(out.intro).toBe(lap.intro)
    expect(out.outro).toBe(lap.outro)
    expect(out.podRound).toBe(lap.podRound)
  })

  it('leaves the lap untouched when the cup is empty', () => {
    const lap = lapOf(podPlay('pod-a'))
    expect(seguePodWithLayer1(lap, [])).toBe(lap)
  })

  it('does not mutate the source lap', () => {
    const lap = lapOf(podPlay('pod-a'))
    seguePodWithLayer1(lap, [l1Play('seed-a')])
    expect(lap.plays.map((p) => p.audioId)).toEqual(['pod-a'])
  })
})

describe('layer1PlaysAsPodPlays', () => {
  it('marks seed plays as Layer 1 so the teleprompter stays audio-only', () => {
    const [play] = layer1PlaysAsPodPlays([l1Play('seed-a', 42)])
    expect(play).toMatchObject({
      sentenceIdx: 42,
      stage: 0,
      playRole: 'ps',
      audioId: 'seed-a',
      glueToNextChunk: false,
      isLayer1: true,
    })
  })
})

describe('podBoundaryOutcome — a pod failure must not take the seed drill down', () => {
  it('plays the lap when the pod composed one', () => {
    expect(podBoundaryOutcome({ hasLap: true, forcePodPreviewCheat: false, layer1Available: true }))
      .toBe('play-lap')
  })

  it('falls back to the seed drill when the pod composes nothing', () => {
    expect(podBoundaryOutcome({ hasLap: false, forcePodPreviewCheat: false, layer1Available: true }))
      .toBe('fallback-layer1')
  })

  it('resumes rather than stranding the player when there is no seed drill either', () => {
    expect(podBoundaryOutcome({ hasLap: false, forcePodPreviewCheat: false, layer1Available: false }))
      .toBe('resume')
  })

  it('keeps the ?pod=1 preview pure — no seed drill substituted for a failed preview', () => {
    expect(podBoundaryOutcome({ hasLap: false, forcePodPreviewCheat: true, layer1Available: true }))
      .toBe('preview-resume')
  })

  it('never returns "resume" when a seed drill is available — silence is the bug being fixed', () => {
    for (const forcePodPreviewCheat of [false]) {
      expect(podBoundaryOutcome({ hasLap: false, forcePodPreviewCheat, layer1Available: true }))
        .not.toBe('resume')
    }
  })
})

/**
 * OFFLINE: THE WHOLE POD, OR NO POD (Tom, 2026-09-01 — "we're ONLY getting the
 * listening SEEDS").
 *
 * A pod-round lap carries the dialogue pod plus the round's seed cup. Filtered
 * to the device as one unit, the dialogue could vanish clip by clip while the
 * seed plays — older course audio, far likelier to be cached — survived whole.
 * The learner heard an all-seeds listening block, it completed, and the ratchet
 * spent a pod round they never heard.
 */
describe('podIsWhollyOnDevice — offline', () => {
  const podPlays = (n: number): PodPlay[] =>
    Array.from({ length: n }, (_, i) => ({
      sentenceIdx: i + 1, stage: 0, playRole: 'ps', audioId: `pod-${i + 1}`,
      text: '', playbackSpeed: 1, glueToNextChunk: false,
    })) as PodPlay[]
  const lapOf = (plays: PodPlay[]): PodLap =>
    ({ podRound: 7, intro: null, outro: null, plays }) as PodLap

  it('is true when every dialogue play survived the device filter', () => {
    const lap = lapOf(podPlays(4))
    expect(podIsWhollyOnDevice(lap, lap)).toBe(true)
  })

  it('is FALSE when the pod was trimmed — most of a pod is not a pod', () => {
    const lap = lapOf(podPlays(4))
    const trimmed = { ...lap, plays: lap.plays.slice(0, 3) }
    expect(podIsWhollyOnDevice(lap, trimmed)).toBe(false)
  })

  it('is false when nothing of the pod is on the device', () => {
    expect(podIsWhollyOnDevice(lapOf(podPlays(4)), null)).toBe(false)
  })

  it('THE FIELD CASE: a segued lap that keeps only its seed cup is not a pod', () => {
    // What the boundary used to hand to playback: pod dialogue gone, seed cup
    // intact. It has plays, so it played — and it was all seeds.
    const pod = lapOf(podPlays(4))
    const segued = seguePodWithLayer1(pod, [
      { seedNumber: 211, role: 'ps', audioId: 'seed-a', text: 'x', playbackSpeed: 1 },
    ] as any)
    const survivedTheFilter = { ...segued, plays: segued.plays.filter((p: any) => p.isLayer1) }
    expect(survivedTheFilter.plays.length).toBeGreaterThan(0) // it would have played
    // Judged on the POD alone — which is the fix — it is not fireable.
    const podAfterFilter = { ...pod, plays: [] as PodPlay[] }
    expect(podIsWhollyOnDevice(pod, podAfterFilter.plays.length ? podAfterFilter : null)).toBe(false)
  })
})
