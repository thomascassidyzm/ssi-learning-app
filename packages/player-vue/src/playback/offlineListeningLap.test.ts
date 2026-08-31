/**
 * The listening loop of death (Tom, iPhone, airplane mode, Spanish, 2026-08-31).
 *
 * "play what you have means play whatever cycles you have COMPLETELY and not
 * keep fucking well trying to play listening exercises you havent got".
 *
 * These cases pin the SELECTION rule: a listening lap is reduced to what this
 * device can actually sound, and when that is nothing the lap does not exist.
 */
import { describe, it, expect } from 'vitest'
import { filterLapToDeviceAudio } from './offlinePlayable'

const onDevice = (...ids: string[]) => (id: string) => ids.includes(id)

/** A pod/L1 sandwich: four plays for one sentence. */
const sandwich = (sentenceIdx: number, prefix: string) => [
  { sentenceIdx, audioId: `${prefix}-ps`, playRole: 'ps' },
  { sentenceIdx, audioId: `${prefix}-trans`, playRole: 'trans' },
  { sentenceIdx, audioId: `${prefix}-ps2`, playRole: 'ps' },
  { sentenceIdx, audioId: `${prefix}-ps3`, playRole: 'ps' },
]

describe('filterLapToDeviceAudio', () => {
  it('returns null when NOTHING in the lap is on the device — the lap must not fire', () => {
    const lap = { intro: { id: 'intro' }, outro: { id: 'outro' }, plays: sandwich(1, 'a') }
    expect(filterLapToDeviceAudio(lap, onDevice())).toBeNull()
  })

  it('returns null when only the bookends are cached — a wrapper is not an exercise', () => {
    const lap = { intro: { id: 'intro' }, outro: { id: 'outro' }, plays: sandwich(1, 'a') }
    expect(filterLapToDeviceAudio(lap, onDevice('intro', 'outro'))).toBeNull()
  })

  it('drops a HALF-cached sentence entirely — completeness is per sentence, not per play', () => {
    const lap = { plays: [...sandwich(1, 'a'), ...sandwich(2, 'b')] }
    // Sentence 1 is missing one of its four slots; sentence 2 is whole.
    const has = onDevice('a-ps', 'a-trans', 'a-ps2', 'b-ps', 'b-trans', 'b-ps2', 'b-ps3')
    const out = filterLapToDeviceAudio(lap, has)
    expect(out).not.toBeNull()
    expect(out!.plays.map(p => p.audioId)).toEqual(['b-ps', 'b-trans', 'b-ps2', 'b-ps3'])
  })

  it('keeps a fully-cached lap intact, bookends and all', () => {
    const lap = { intro: { id: 'intro' }, outro: { id: 'outro' }, plays: sandwich(1, 'a') }
    const out = filterLapToDeviceAudio(lap, onDevice('intro', 'outro', 'a-ps', 'a-trans', 'a-ps2', 'a-ps3'))
    expect(out!.plays).toHaveLength(4)
    expect(out!.intro).toEqual({ id: 'intro' })
    expect(out!.outro).toEqual({ id: 'outro' })
  })

  it('drops only the missing bookend, keeping playable sentences', () => {
    const lap = { intro: { id: 'intro' }, outro: { id: 'outro' }, plays: sandwich(1, 'a') }
    const out = filterLapToDeviceAudio(lap, onDevice('outro', 'a-ps', 'a-trans', 'a-ps2', 'a-ps3'))
    expect(out!.intro).toBeNull()
    expect(out!.outro).toEqual({ id: 'outro' })
    expect(out!.plays).toHaveLength(4)
  })

  it('fails closed on blank and missing audio ids', () => {
    const lap = { plays: [{ sentenceIdx: 1, audioId: '' }, { sentenceIdx: 2, audioId: null }] }
    // A blank id must never be read as "nothing to check, therefore fine" —
    // that exact hole is what let silent cycles through before 2026-08-15.
    expect(filterLapToDeviceAudio(lap, () => true)).toBeNull()
  })

  it('treats a play with no sentenceIdx as its own unit', () => {
    const lap = { plays: [{ audioId: 'x' }, { audioId: 'y' }] }
    const out = filterLapToDeviceAudio(lap, onDevice('y'))
    expect(out!.plays.map(p => p.audioId)).toEqual(['y'])
  })

  it('returns null for an empty or absent lap', () => {
    expect(filterLapToDeviceAudio(null, () => true)).toBeNull()
    expect(filterLapToDeviceAudio({ plays: [] }, () => true)).toBeNull()
  })
})
