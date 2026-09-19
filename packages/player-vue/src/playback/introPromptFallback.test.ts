/**
 * A DEAD INTRO NARRATION IS NOT A DEAD INTRO (job #256, 2026-09-19).
 *
 * cym_s_for_eng S0006L01 "alla i ddim" has no narration linked on
 * course_legos; the script generator backfilled one from a legacy
 * `lego_introductions` row whose audio id is in no audio table, so
 * `/api/audio/<id>` answered 404 with a JSON body and the element refused it
 * (MEDIA_ERR_SRC_NOT_SUPPORTED, readyState 0). The intro was then skipped —
 * 96 failures in the week of 12–19 September, 35 of the 36 learners who
 * reached it, on every platform and five builds.
 *
 * The cycle carries the LEGO's own known clip as `known.fallbackUrl`, and a
 * prompt that cannot play falls back to it instead of being skipped.
 */
import { describe, it, expect } from 'vitest'
import { SimplePlayer } from './SimplePlayer'

const DEAD = '/api/audio/dangling-narration'
const KNOWN = '/api/audio/known-1'

const introRound = (opts: { fallback?: string } = {}) => ({
  roundNumber: 1,
  legoId: 'S0006L01',
  cycles: [{
    id: 'S0006L01_intro',
    type: 'intro',
    legoId: 'S0006L01',
    known: { text: 'I can’t', audioUrl: DEAD, ...(opts.fallback ? { fallbackUrl: opts.fallback } : {}) },
    target: { text: 'alla i ddim', voice1Url: '/api/audio/t1', voice2Url: '/api/audio/t2' },
    pauseDuration: 0,
  }],
})

function harness(round: any) {
  const assigned: string[] = []
  const failures: any[] = []
  const player: any = new SimplePlayer([round] as any)
  Object.defineProperty(player.audio, 'src', {
    configurable: true,
    get: () => assigned[assigned.length - 1] ?? '',
    set: (v: string) => { assigned.push(v) },
  })
  player.audio.play = () => Promise.resolve()
  player.audio.load = () => {}
  player.on('audio_failed', (c: any) => failures.push(c))
  return { player, assigned, failures }
}

/** The element's two error events: first burns the retry, second gives up. */
const failTwice = (player: any) => {
  player.handleAudioFailure(4, 'MEDIA_ELEMENT_ERROR: Format error')
  player.handleAudioFailure(4, 'MEDIA_ELEMENT_ERROR: Format error')
}

describe('intro prompt fallback', () => {
  it('plays the known clip when the narration prompt cannot be played', async () => {
    const { player, assigned, failures } = harness(introRound({ fallback: KNOWN }))
    player.play()
    await Promise.resolve(); await Promise.resolve()
    expect(assigned).toContain(DEAD)

    failTwice(player)
    await Promise.resolve(); await Promise.resolve()

    // The known clip took the prompt's place...
    expect(assigned).toContain(KNOWN)
    // ...and the engine stayed on the intro rather than advancing past it.
    expect(player.state.phase).toBe('prompt')
    // A clip DID sound, so this is not a silent skip.
    expect(player.consecutiveSkips).toBe(0)
    // The dead narration is still reported, so telemetry keeps seeing it.
    expect(failures.some((f) => String(f.lastError).includes('prompt-fallback-to-known'))).toBe(true)
  })

  it('is used at most once per prompt — a dead fallback still skips', async () => {
    const { player, assigned } = harness(introRound({ fallback: KNOWN }))
    player.play()
    await Promise.resolve(); await Promise.resolve()
    failTwice(player)
    await Promise.resolve(); await Promise.resolve()
    const afterFallback = assigned.length
    failTwice(player)
    await Promise.resolve(); await Promise.resolve()
    // No second fallback attempt: at most one retry of the known clip itself.
    expect(assigned.slice(afterFallback).filter((u) => u === KNOWN).length).toBeLessThanOrEqual(1)
    expect(player.consecutiveSkips).toBe(1)
  })

  it('a cycle with no fallback behaves exactly as before — skipped', async () => {
    const { player, assigned } = harness(introRound())
    player.play()
    await Promise.resolve(); await Promise.resolve()
    failTwice(player)
    await Promise.resolve(); await Promise.resolve()
    expect(assigned).not.toContain(KNOWN)
    expect(player.consecutiveSkips).toBe(1)
  })
})
