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

/**
 * BELT SKIP MUST NOT OFFER A BELT THE DEVICE CANNOT TEACH.
 *
 * Tom, 2026-08-31: "perhaps belt skip should NOT work when unexpected offline
 * and no new LEGOS are available." The specimen is his own Blue-belt landing
 * round, S0084L01 ("dijo"): its review cycles were cached, its debut was not,
 * and `some(playable)` called that available.
 */
import { roundTeachesOffline, NEW_LEGO_CYCLE_TYPES } from './offlinePlayable'

const cyc = (type: string, ids: string[]) => ({
  type,
  known: { audioUrl: `/api/audio/${ids[0]}` },
  target: { voice1Url: `/api/audio/${ids[1]}`, voice2Url: `/api/audio/${ids[2]}` },
})

describe('roundTeachesOffline — the belt-skip gate', () => {
  it("Tom's case: cached review cycles do NOT make a belt available", () => {
    const round = [
      cyc('debut', ['d1', 'd2', 'd3']),          // the new LEGO — NOT on device
      cyc('spaced_rep', ['r1', 'r2', 'r3']),     // older material — cached
    ]
    expect(roundTeachesOffline(round, onDevice('r1', 'r2', 'r3'))).toBe(false)
  })

  it('is true only when EVERY teaching cycle is complete on the device', () => {
    const round = [
      cyc('intro', ['i1', 'i2', 'i3']),
      cyc('debut', ['d1', 'd2', 'd3']),
      cyc('build', ['b1', 'b2', 'b3']),
    ]
    const all = onDevice('i1', 'i2', 'i3', 'd1', 'd2', 'd3', 'b1', 'b2', 'b3')
    expect(roundTeachesOffline(round, all)).toBe(true)
    // one clip of one build missing → the LEGO can't be taught
    const missingOne = onDevice('i1', 'i2', 'i3', 'd1', 'd2', 'd3', 'b1', 'b2')
    expect(roundTeachesOffline(round, missingOne)).toBe(false)
  })

  it('review-only rounds are never "available" — no new LEGOs there', () => {
    const round = [cyc('spaced_rep', ['r1', 'r2', 'r3']), cyc('use', ['u1', 'u2', 'u3'])]
    expect(roundTeachesOffline(round, () => true)).toBe(false)
  })

  it('an absent or empty round fails closed', () => {
    expect(roundTeachesOffline([], () => true)).toBe(false)
    expect(roundTeachesOffline(null, () => true)).toBe(false)
    expect(roundTeachesOffline(undefined, () => true)).toBe(false)
  })

  it('listening and pod cycles are not teaching cycles', () => {
    for (const t of ['listening', 'pod', 'listen_intro', 'listen_outro', 'spaced_rep', 'use']) {
      expect(NEW_LEGO_CYCLE_TYPES.has(t)).toBe(false)
    }
    for (const t of ['intro', 'debut', 'build']) {
      expect(NEW_LEGO_CYCLE_TYPES.has(t)).toBe(true)
    }
  })
})

/**
 * SEGUED POD LAPS: two numbering systems in one lap.
 *
 * Pod sentence indices and Layer-1 seed numbers both start at 1 and both ride
 * in `sentenceIdx`. Keyed together, pod sentence 211 and course seed 211 became
 * one completeness unit — so one missing clip on either side deleted the other.
 */
describe('filterLapToDeviceAudio — pod plays and seed-cup plays are different units', () => {
  const podSentence = (idx: number, prefix: string) =>
    sandwich(idx, prefix).map((p) => ({ ...p, isLayer1: false }))
  const seedSentence = (idx: number, prefix: string) =>
    sandwich(idx, prefix).map((p) => ({ ...p, isLayer1: true }))

  it('a missing pod sentence does not delete the seed sentence that shares its number', () => {
    const lap = {
      intro: null,
      outro: null,
      plays: [...podSentence(211, 'pod'), ...seedSentence(211, 'seed')],
    }
    // Only the seed clips are on the device — the pod's are not.
    const out = filterLapToDeviceAudio(lap, onDevice('seed-ps', 'seed-trans', 'seed-ps2', 'seed-ps3'))
    expect(out).not.toBeNull()
    expect(out!.plays.map((p: any) => p.audioId)).toEqual(['seed-ps', 'seed-trans', 'seed-ps2', 'seed-ps3'])
  })

  it('a missing seed sentence does not delete the pod sentence that shares its number', () => {
    const lap = {
      intro: null,
      outro: null,
      plays: [...podSentence(211, 'pod'), ...seedSentence(211, 'seed')],
    }
    const out = filterLapToDeviceAudio(lap, onDevice('pod-ps', 'pod-trans', 'pod-ps2', 'pod-ps3'))
    expect(out).not.toBeNull()
    expect(out!.plays.map((p: any) => p.audioId)).toEqual(['pod-ps', 'pod-trans', 'pod-ps2', 'pod-ps3'])
  })
})
