/**
 * breathGroups — the Immersion tracker's grain (job #408).
 *
 * Fixtures are REAL rows read from the live DB on 2026-09-12: spa_for_eng
 * pod-1 global_order 229 (a four-sentence turn with Azure word boundaries)
 * and a short single-breath sentence. The contract shape is the #407 one.
 */
import { describe, it, expect } from 'vitest'
import {
  BREATH_PAUSE_SEC,
  normaliseWordTimings,
  buildBreathGroups,
  alignBreathGroups,
  breathGroupsForClip,
  trackPosition,
} from './breathGroups'

// spa_for_eng:pod-1 #229 — course_audio.word_boundaries, verbatim (ms).
const SPA_229_AZURE = [
  { text: 'Esto', offset: 50, duration: 313 }, { text: 'es', offset: 375, duration: 188 },
  { text: 'exactamente', offset: 563, duration: 725 }, { text: 'el', offset: 1288, duration: 100 },
  { text: 'tipo', offset: 1388, duration: 263 }, { text: 'de', offset: 1650, duration: 100 },
  { text: 'práctica', offset: 1750, duration: 463 }, { text: 'que', offset: 2213, duration: 125 },
  { text: 'necesito', offset: 2338, duration: 550 }, { text: '.', offset: 2975, duration: 25 },
  { text: '¡Creo', offset: 4263, duration: 250 }, { text: 'que', offset: 4513, duration: 138 },
  { text: 'puedo', offset: 4663, duration: 288 }, { text: 'sentir', offset: 4950, duration: 425 },
  { text: 'cómo', offset: 5375, duration: 238 }, { text: 'me', offset: 5613, duration: 100 },
  { text: 'está', offset: 5713, duration: 225 }, { text: 'cambiando', offset: 5938, duration: 488 },
  { text: 'el', offset: 6425, duration: 75 }, { text: 'cerebro', offset: 6500, duration: 413 },
  { text: 'mientras', offset: 6913, duration: 425 }, { text: 'hablamos', offset: 7338, duration: 500 },
  { text: '!', offset: 7875, duration: 38 }, { text: 'Realmente', offset: 9175, duration: 675 },
  { text: 'agradezco', offset: 9850, duration: 550 }, { text: 'tu', offset: 10400, duration: 125 },
  { text: 'ayuda', offset: 10525, duration: 388 }, { text: '.', offset: 10975, duration: 63 },
  { text: 'Pero', offset: 12313, duration: 200 }, { text: 'es', offset: 12513, duration: 113 },
  { text: 'sorprendente', offset: 12625, duration: 688 }, { text: 'lo', offset: 13313, duration: 100 },
  { text: 'cansado', offset: 13413, duration: 463 }, { text: 'que', offset: 13875, duration: 125 },
  { text: 'me', offset: 14000, duration: 113 }, { text: 'pongo', offset: 14113, duration: 313 },
  { text: 'cuando', offset: 14425, duration: 313 }, { text: 'hablo', offset: 14738, duration: 238 },
  { text: 'en', offset: 14975, duration: 113 }, { text: 'un', offset: 15088, duration: 138 },
  { text: 'idioma', offset: 15238, duration: 350 }, { text: 'que', offset: 15588, duration: 150 },
  { text: 'no', offset: 15738, duration: 138 }, { text: 'hablo', offset: 15875, duration: 225 },
  { text: 'muy', offset: 16100, duration: 175 }, { text: 'bien', offset: 16275, duration: 288 },
  { text: '.', offset: 16588, duration: 50 },
]
// listening_pod_sentences.target_text for the same row — NOT the clip's text:
// the row says "cansada" where the render said "cansado", and has no "…" markers.
const SPA_229_TEXT = 'Esto es exactamente el tipo de práctica que necesito. ¡Creo que puedo sentir cómo me está cambiando el cerebro mientras hablamos! Realmente agradezco tu ayuda. Pero es sorprendente lo cansada que me pongo cuando hablo en un idioma que no hablo muy bien.'

// A single-breath sentence: the 200 ms comma gap is under the threshold.
const SPA_ONE_BREATH_AZURE = [
  { text: 'Es', offset: 6063, duration: 175 }, { text: 'un', offset: 6238, duration: 138 },
  { text: 'poco', offset: 6375, duration: 263 }, { text: 'difícil', offset: 6638, duration: 438 },
  { text: 'pensar', offset: 7075, duration: 425 }, { text: 'en', offset: 7500, duration: 138 },
  { text: 'algo', offset: 7638, duration: 225 }, { text: 'que', offset: 7863, duration: 138 },
  { text: 'decir', offset: 8000, duration: 338 }, { text: ',', offset: 8538, duration: 0 },
  { text: 'aunque', offset: 8538, duration: 325 }, { text: '.', offset: 8925, duration: 63 },
]

const CONTRACT = {
  source: 'cartesia',
  words: ['Buongiorno', 'come', 'stai', 'oggi'],
  starts: [0.05, 0.9, 1.1, 1.35],
  ends: [0.55, 1.08, 1.3, 1.7],
}

// The first LIVE #407 row: course_audio 04f7c18e-9688-4a11-bd78-9160df55768b
// (zzz_test2_for_eng), word_timings verbatim as read on 2026-09-12 — seconds,
// punctuation attached to the words rather than tokenised on its own.
const LIVE_407_ROW = {
  id: '04f7c18e-9688-4a11-bd78-9160df55768b',
  text: 'A black coffee, please.',
  word_boundaries: null,
  word_timings: {
    source: 'cartesia',
    words: ['A', 'black', 'coffee,', 'please.'],
    starts: [0.04, 0.12, 0.52, 0.841],
    ends: [0.12, 0.44, 0.84, 1.32],
  },
}

describe('normaliseWordTimings', () => {
  it('accepts the #407 contract shape as-is (seconds)', () => {
    expect(normaliseWordTimings(CONTRACT)).toEqual({ words: CONTRACT.words, starts: CONTRACT.starts, ends: CONTRACT.ends })
  })
  it('accepts the live Cartesia row exactly as course_audio.word_timings carries it', () => {
    const t = normaliseWordTimings(LIVE_407_ROW.word_timings)
    expect(t).toEqual({
      words: ['A', 'black', 'coffee,', 'please.'],
      starts: [0.04, 0.12, 0.52, 0.841],
      ends: [0.12, 0.44, 0.84, 1.32],
    })
    // One breath (largest gap is 80 ms at "coffee, please"): the attached
    // punctuation does not fool the alignment, the group takes the sentence's
    // own text, and breathGroupsForClip stays null as it does for every
    // single-breath sentence (the existing card renders unchanged).
    const groups = alignBreathGroups(buildBreathGroups(t!), t!, LIVE_407_ROW.text)
    expect(groups.map((g) => g.text)).toEqual(['A black coffee, please.'])
    expect(groups[0].start).toBeCloseTo(0.04, 3)
    expect(groups[0].end).toBeCloseTo(1.32, 3)
    expect(breathGroupsForClip(LIVE_407_ROW.word_timings, LIVE_407_ROW.text)).toBeNull()
  })
  it('converts the Azure word_boundaries shape to seconds and folds punctuation into the word before it', () => {
    const t = normaliseWordTimings(SPA_ONE_BREATH_AZURE)!
    expect(t.words).toEqual(['Es', 'un', 'poco', 'difícil', 'pensar', 'en', 'algo', 'que', 'decir', 'aunque'])
    expect(t.starts[0]).toBeCloseTo(6.063, 3)
    // "decir" absorbs the comma's stamp; "aunque" absorbs the full stop's.
    expect(t.ends[8]).toBeCloseTo(8.538, 3)
    expect(t.ends[9]).toBeCloseTo(8.988, 3)
  })
  it('returns null for null, empty, the all-zero [[0,0],…] rows, and ragged arrays', () => {
    expect(normaliseWordTimings(null)).toBeNull()
    expect(normaliseWordTimings([])).toBeNull()
    expect(normaliseWordTimings([[0, 0], [0, 0], [0, 0]])).toBeNull()
    expect(normaliseWordTimings({ source: 'cartesia', words: ['a', 'b'], starts: [0], ends: [0.2, 0.4] })).toBeNull()
    expect(normaliseWordTimings({ words: ['a'], starts: [0.5], ends: [0.2] })).toBeNull()
  })
})

describe('buildBreathGroups — grain from the audio, threshold from the data', () => {
  it(`cuts at pauses of ${BREATH_PAUSE_SEC * 1000} ms or more and nowhere else`, () => {
    const groups = buildBreathGroups(normaliseWordTimings(SPA_229_AZURE)!)
    // Four sentences, four pauses of 1.2–1.3 s, no cut inside any of them.
    expect(groups.map((g) => g.text)).toEqual([
      'Esto es exactamente el tipo de práctica que necesito',
      '¡Creo que puedo sentir cómo me está cambiando el cerebro mientras hablamos',
      'Realmente agradezco tu ayuda',
      'Pero es sorprendente lo cansado que me pongo cuando hablo en un idioma que no hablo muy bien',
    ])
    expect(groups[0].start).toBeCloseTo(0.05, 3)
    expect(groups[0].end).toBeCloseTo(3.0, 3)
    expect(groups[1].start).toBeCloseTo(4.263, 3)
  })
  it('keeps a sentence whole when its only gap is under the threshold', () => {
    expect(buildBreathGroups(normaliseWordTimings(SPA_ONE_BREATH_AZURE)!)).toHaveLength(1)
  })
  it('splits the contract-shaped clip at its one 350 ms pause', () => {
    const groups = buildBreathGroups(normaliseWordTimings(CONTRACT)!)
    expect(groups.map((g) => g.text)).toEqual(['Buongiorno', 'come stai oggi'])
  })
})

describe('alignBreathGroups — the sentence text, not the TTS token text', () => {
  it('slices the pod row text so each group reads with its own punctuation and the row\'s own spelling', () => {
    const t = normaliseWordTimings(SPA_229_AZURE)!
    const groups = alignBreathGroups(buildBreathGroups(t), t, SPA_229_TEXT)
    expect(groups.map((g) => g.text)).toEqual([
      'Esto es exactamente el tipo de práctica que necesito.',
      '¡Creo que puedo sentir cómo me está cambiando el cerebro mientras hablamos!',
      'Realmente agradezco tu ayuda.',
      'Pero es sorprendente lo cansada que me pongo cuando hablo en un idioma que no hablo muy bien.',
    ])
    // Slices are exhaustive: joined back together they are the sentence.
    expect(groups.map((g) => g.text).join(' ')).toBe(SPA_229_TEXT)
  })
  it('falls back to the joined timing words when the text does not align', () => {
    const t = normaliseWordTimings(CONTRACT)!
    const groups = alignBreathGroups(buildBreathGroups(t), t, 'Something else entirely, not those words.')
    expect(groups.map((g) => g.text)).toEqual(['Buongiorno', 'come stai oggi'])
  })
})

describe('breathGroupsForClip — the one condition', () => {
  it('is null for a null payload, for a single-breath sentence, and for degenerate timings', () => {
    expect(breathGroupsForClip(null, 'Hola.')).toBeNull()
    expect(breathGroupsForClip(SPA_ONE_BREATH_AZURE, 'Es un poco difícil pensar en algo que decir, aunque.')).toBeNull()
    expect(breathGroupsForClip([[0, 0], [0, 0]], 'Agus ansin?')).toBeNull()
  })
  it('is the aligned stack for a multi-breath sentence', () => {
    expect(breathGroupsForClip(SPA_229_AZURE, SPA_229_TEXT)).toHaveLength(4)
  })
})

describe('trackPosition — the lit group walks with the clock', () => {
  const groups = breathGroupsForClip(SPA_229_AZURE, SPA_229_TEXT)!
  it('lights the first group at zero fill before the first word', () => {
    expect(trackPosition(groups, 0)).toEqual({ index: 0, fill: 0 })
  })
  it('fills smoothly inside a group', () => {
    const mid = (groups[0].start + groups[0].end) / 2
    const p = trackPosition(groups, mid)
    expect(p.index).toBe(0)
    expect(p.fill).toBeCloseTo(0.5, 2)
  })
  it('holds the finished group full across the pause, then lights the next', () => {
    expect(trackPosition(groups, 3.6)).toEqual({ index: 0, fill: 1 })
    expect(trackPosition(groups, 4.3).index).toBe(1)
  })
  it('holds the last group full after the clip ends', () => {
    expect(trackPosition(groups, 99)).toEqual({ index: 3, fill: 1 })
  })
})
