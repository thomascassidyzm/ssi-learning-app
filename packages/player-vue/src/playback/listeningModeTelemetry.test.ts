/**
 * Listening Mode per-clip telemetry (job #325, Tom 2026-09-12: "listening
 * exercises in main flow, v. in Listening Mode — main flow is constrained and
 * Listening MODE is free to navigate around"). Before this, ListeningOverlay
 * logged no audio_play at all, only a 30 s listening_tick, so the two could be
 * sized against each other but never inspected side by side.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildListeningModePlayEvent, LISTENING_MODE_CYCLE_TYPE } from './listeningModeTelemetry'

const input = {
  audioId: 'abc-123',
  url: '/api/audio/abc-123',
  role: 'target' as const,
  view: 'pods',
  listenMode: 'immersion',
  sceneNumber: 2,
  phraseIndex: 7,
  clipIndex: 0,
  clipCount: 1,
  playbackSpeed: 0.85,
  elapsedMs: 1840,
  cacheHit: true,
  ok: true,
  seedNumber: 42,
  legoId: 'S0042L03',
}

describe('buildListeningModePlayEvent', () => {
  it('has the same shape as a main-flow pod play, with a cycleType that names Listening Mode', () => {
    const ev = buildListeningModePlayEvent(input)
    // The keys a pod_play row carries, so one query can put the two side by side.
    expect(ev).toMatchObject({
      url: '/api/audio/abc-123',
      role: 'target',
      cycleType: LISTENING_MODE_CYCLE_TYPE,
      legoId: 'S0042L03',
      seedId: 'S0042',
      playbackSpeed: 0.85,
      elapsedMs: 1840,
      cacheHit: true,
      reason: 'ended',
      playIndex: 0,
      sentenceIdx: 7,
    })
    // What only Listening Mode has: where the learner navigated to.
    expect(ev).toMatchObject({ view: 'pods', listenMode: 'immersion', scene: 2, playCount: 1 })
    expect(LISTENING_MODE_CYCLE_TYPE).toBe('listening_mode')
  })

  it('a pod scene row has no seed or lego, and says so with null rather than an invented id', () => {
    const ev = buildListeningModePlayEvent({ ...input, seedNumber: undefined, legoId: '', sceneNumber: null })
    expect(ev.seedId).toBeNull()
    expect(ev.legoId).toBeNull()
    expect(ev.scene).toBeNull()
  })

  it('a clip whose play threw is still a row, marked as such', () => {
    expect(buildListeningModePlayEvent({ ...input, ok: false }).reason).toBe('error')
  })

  it('ListeningOverlay logs it as an audio_play on every clip and keeps the 30 s listening_tick', () => {
    const src = readFileSync(resolve(__dirname, '../components/ListeningOverlay.vue'), 'utf8')
    expect(src).toContain("logEvent('audio_play', buildListeningModePlayEvent(")
    expect(src).toContain("logEvent('listening_tick'")
  })
})
