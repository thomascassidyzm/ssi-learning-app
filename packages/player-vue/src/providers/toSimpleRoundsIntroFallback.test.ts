/**
 * The legacy script path carries the same intro prompt fallback as the
 * instant-playback adapter (job #256): when the prompt is the narration, the
 * LEGO's own known clip rides along so a narration that cannot be played
 * degrades to a quiet intro instead of a skipped one.
 */
import { describe, it, expect } from 'vitest'
import { toSimpleRounds } from './toSimpleRounds'

const introItem = (over: Record<string, unknown> = {}) => ({
  uuid: 'S0006L01_intro',
  cycleNum: 1,
  roundNumber: 1,
  seedId: 'S0006',
  legoKey: 'S0006L01',
  seedCode: 'S0006',
  legoCode: 'L01',
  type: 'intro',
  knownText: 'I can’t',
  targetText: 'alla i ddim',
  knownAudioId: 'k-1',
  target1Id: 't1-1',
  target2Id: 't2-1',
  target1DurationMs: 1000,
  target2DurationMs: 1000,
  isNew: true,
  ...over,
})

const intro = (item: Record<string, unknown>) => toSimpleRounds([item] as any)[0].cycles[0]

describe('toSimpleRounds — intro prompt fallback', () => {
  it('carries the known clip behind a narration prompt', () => {
    const c = intro(introItem({ presentationAudioId: 'pres-1' }))
    expect(c.known.audioUrl).toBe('/api/audio/pres-1')
    expect(c.known.fallbackUrl).toBe('/api/audio/k-1')
  })

  it('sets no fallback when the prompt is already the known clip', () => {
    const c = intro(introItem())
    expect(c.known.audioUrl).toBe('/api/audio/k-1')
    expect(c.known.fallbackUrl).toBeUndefined()
  })

  it('sets no fallback on a speaking cycle', () => {
    const c = intro(introItem({ type: 'build', uuid: 'S0006L01_build_1', presentationAudioId: 'pres-1' }))
    expect(c.known.fallbackUrl).toBeUndefined()
  })
})
