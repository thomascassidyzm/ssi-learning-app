/**
 * podModalQueue — what plays for a listening unit, per mode.
 *
 * The case that forced this file: Steve's Senedd/S4C pod
 * (cym_n_for_eng:senedd-s4c-steve) is a bilingual committee transcript, and 51
 * of its 160 contributions were spoken IN ENGLISH on the floor. Nothing was
 * invented in Welsh for them, so those 168 lines carry an EMPTY target_text and
 * no target clip — their known clip IS the recording of what was said. Before
 * this, immersion mode pushed nothing for them: the pod played silence through
 * the questions and then played the Welsh answers to them.
 *
 * The distinction the fallback turns on is target TEXT, not the missing clip.
 */
import { describe, it, expect } from 'vitest'
import { buildModalQueue, type ModalUnit } from './podModalQueue'

const welsh: ModalUnit = { targetText: 'Prynhawn da.', targetAudioId: 'cy1', knownAudioId: 'en1' }
/** An English contribution on the floor: never said in Welsh, so no Welsh text. */
const floorEnglish: ModalUnit = { targetText: '', targetAudioId: null, knownAudioId: 'en2' }
/** A Welsh line whose recording has not been made yet. NOT the same thing. */
const unrecordedWelsh: ModalUnit = { targetText: 'Bore da.', targetAudioId: null, knownAudioId: 'en3' }

describe('immersion', () => {
  it('plays the target when there is one', () => {
    expect(buildModalQueue([welsh], 'immersion', 1)).toEqual([{ id: 'cy1', rate: 1 }])
  })

  it('plays the ENGLISH for a line that was never in the target language', () => {
    expect(buildModalQueue([floorEnglish], 'immersion', 1)).toEqual([{ id: 'en2', rate: 1 }])
  })

  it('stays SILENT for a target line whose recording is missing — a gap must sound like a gap', () => {
    expect(buildModalQueue([unrecordedWelsh], 'immersion', 1)).toEqual([])
  })

  it('treats whitespace-only target text as no target text', () => {
    expect(buildModalQueue([{ targetText: '   ', targetAudioId: null, knownAudioId: 'en4' }], 'immersion', 1))
      .toEqual([{ id: 'en4', rate: 1 }])
  })

  it('plays a floor turn with no known clip as nothing rather than throwing', () => {
    expect(buildModalQueue([{ targetText: '', targetAudioId: null, knownAudioId: null }], 'immersion', 1)).toEqual([])
  })

  it('keeps a mixed session in order — question in English, answer in Welsh', () => {
    expect(buildModalQueue([floorEnglish, welsh], 'immersion', 1))
      .toEqual([{ id: 'en2', rate: 1 }, { id: 'cy1', rate: 1 }])
  })

  it('carries the chosen speed onto every item', () => {
    expect(buildModalQueue([welsh, floorEnglish], 'immersion', 0.8).map((q) => q.rate)).toEqual([0.8, 0.8])
  })
})

describe('drill is unchanged', () => {
  it('runs target · known · target · target', () => {
    expect(buildModalQueue([welsh], 'drill', 1).map((q) => q.id)).toEqual(['cy1', 'en1', 'cy1', 'cy1'])
  })

  it('plays a targetless unit’s known alone, as it always has', () => {
    expect(buildModalQueue([floorEnglish], 'drill', 1)).toEqual([{ id: 'en2', rate: 1 }])
  })

  it('still plays the known alone for an unrecorded target — drill is deliberately broader than immersion', () => {
    expect(buildModalQueue([unrecordedWelsh], 'drill', 1)).toEqual([{ id: 'en3', rate: 1 }])
  })
})
