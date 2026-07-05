import { describe, it, expect } from 'vitest'
import {
  isLadderEligible,
  ladderViewFor,
  buildTurnLadderRungs,
  ladderRungToPlays,
  normForAudio,
  LADDER_SPEED_PLAYLIST,
} from './ladderComposition'
import type { PodSentenceRow } from './podStageComposition'

// Fixture: a 2-sentence turn — "Muy bien, gracias. ¿Vas al trabajo?" — with a
// flat atom_map_fine across both sentences (5 fusible units: 2 + 3), Take G
// renders per sentence-group, and a mix of real fine-known / fallback
// resolution paths so the ladder's degrade-gracefully branches are exercised.
const baseRow = (over: Partial<PodSentenceRow> = {}): PodSentenceRow => ({
  global_order: 1,
  target_text: 'Muy bien, gracias. ¿Vas al trabajo?',
  known_text: "I'm very well, thank you. Are you going to work?",
  target_audio_id: 'turn-target',
  known_audio_id: 'turn-known',
  explainer_audio_id: null,
  glue_to_next: false,
  atom_map: null,
  atom_map_fine: [
    { lego_key: 'L_muybien', kind: 'atom', gloss: 'very well', target_surface: 'Muy bien', target_start_ms: 0, target_end_ms: 500 },
    { lego_key: 'L_gracias', kind: 'atom', gloss: 'thank you', target_surface: 'gracias', target_start_ms: 500, target_end_ms: 900 },
    { lego_key: 'L_vas', kind: 'atom', gloss: 'are you going', target_surface: '¿Vas', target_start_ms: 900, target_end_ms: 1200 },
    { lego_key: 'L_al', kind: 'atom', gloss: 'to', target_surface: 'al', target_start_ms: 1200, target_end_ms: 1400 },
    { lego_key: 'L_trabajo', kind: 'atom', gloss: 'work', target_surface: 'trabajo', target_start_ms: 1400, target_end_ms: 1900 },
  ],
  takeg_audio_ids: ['take-g-1', 'take-g-2'],
  sentence_audio_ids: ['sent-clip-1', 'sent-clip-2'],
  sentence_known_audio_ids: ['sent-known-1', null],
  window_known_map: [{ start: 2, end: 3, known: 'are you going' }],
  ...over,
})

const glossMap = new Map([
  ['L_gracias', 'm-gracias'],
  ['L_vas', 'm-vas'],
  ['L_al', 'm-al'],
  ['L_trabajo', 'm-trabajo'],
])
const targetClipMap = new Map<string, string>() // Stage-0 per-unit clips — unused when Take G slices cleanly
const fineKnownMap = new Map([
  [normForAudio('very well'), 'fine-very-well'],
  [normForAudio('are you going'), 'fine-vasal'],
  [normForAudio('are you going to work'), 'fine-join-2'],
])
const opts = { glossMap, targetClipMap, fineKnownMap }

describe('isLadderEligible', () => {
  it('true when the row has a target clip and at least one fusible atom_map_fine entry', () => {
    expect(isLadderEligible(baseRow())).toBe(true)
  })
  it('false with no atom_map_fine (the automatic Stage-0..N fallback gate)', () => {
    expect(isLadderEligible(baseRow({ atom_map_fine: null }))).toBe(false)
  })
  it('false with no target_audio_id', () => {
    expect(isLadderEligible(baseRow({ target_audio_id: null }))).toBe(false)
  })
  it('false when atom_map_fine has only note entries', () => {
    expect(isLadderEligible(baseRow({
      atom_map_fine: [{ lego_key: '', kind: 'note', gloss: '', target_surface: '' }],
    }))).toBe(false)
  })
})

describe('buildTurnLadderRungs — the unified climb', () => {
  const rungs = buildTurnLadderRungs(baseRow(), opts)

  it('produces fusion rungs (maxDepth=3: sentence1 has 2 levels, sentence2 has 3) + 1 conjoin rung + 7 speed-ramp rungs', () => {
    expect(rungs.length).toBe(3 + 1 + 7)
  })

  it('rung 0 (finest units): each unit gets its own Take-G-sliced t·k·t·t', () => {
    const steps = rungs[0].steps
    // "Muy bien" chunk — sliced from take-g-1 at its own ms span
    expect(steps[0]).toMatchObject({ kind: 'chunk', clips: [{ id: 'take-g-1', startMs: 0, endMs: 500 }] })
    // its known — real fine-known clip found by gloss text
    expect(steps[1]).toMatchObject({ kind: 'gloss', clips: ['fine-very-well'] })
    // t·k·t·t: two more chunk reps
    expect(steps[2].kind).toBe('chunk')
    expect(steps[3].kind).toBe('chunk')
    // "gracias" chunk — sliced from the SAME take-g-1 at its own span
    expect(steps[4]).toMatchObject({ kind: 'chunk', clips: [{ id: 'take-g-1', startMs: 500, endMs: 900 }] })
    // its known — no fine-known entry for "thank you" → falls back to the means-gloss clip
    expect(steps[5]).toMatchObject({ kind: 'gloss', clips: ['m-gracias'] })
  })

  it('rung 1: sentence 1 (already whole) repeats wholeSentenceChunk/Known; sentence 2 has one fused pair + one lone unit', () => {
    const steps = rungs[1].steps
    // sentence 1 whole — its real per-sentence take, not Take G (a real take wins)
    expect(steps[0]).toMatchObject({ kind: 'group', clips: ['sent-clip-1'] })
    // sentence 1's known — sentence_known_audio_ids[0] wins (no fine-known match for the punctuated sentence text)
    expect(steps[1]).toMatchObject({ kind: 'gloss', clips: ['sent-known-1'] })
    // sentence 2's fused pair "¿Vas al" — sliced across the pair's full span
    const pairChunkIdx = steps.findIndex((s) => s.kind === 'chunk' && Array.isArray(s.clips) && typeof s.clips[0] === 'object')
    expect(steps[pairChunkIdx]).toMatchObject({ kind: 'chunk', clips: [{ id: 'take-g-2', startMs: 900, endMs: 1400 }] })
    // its known — resolved via window_known_map ("are you going") → real fine-known clip
    expect(steps[pairChunkIdx + 1]).toMatchObject({ kind: 'gloss', clips: ['fine-vasal'] })
  })

  it('rung 2: both sentences fully whole; sentence 2 falls back to the joined-gloss fine-known clip (no take, no sentence-text match)', () => {
    const steps = rungs[2].steps
    const sent2WholeIdx = steps.findIndex((s) => s.kind === 'group' && s.clips[0] === 'sent-clip-2')
    expect(sent2WholeIdx).toBeGreaterThanOrEqual(0)
    expect(steps[sent2WholeIdx + 1]).toMatchObject({ kind: 'gloss', clips: ['fine-join-2'] })
  })

  it('the conjoin rung is the whole turn (single conjoin level for a 2-sentence turn)', () => {
    const conjoinRung = rungs[3]
    expect(conjoinRung.steps[0]).toMatchObject({ kind: 'whole', clips: ['turn-target'] })
    expect(conjoinRung.steps[1]).toMatchObject({ kind: 'gloss', clips: ['turn-known'] })
  })

  it('the speed ramp is LADDER_SPEED_PLAYLIST[2..8] on the whole turn, ending on an eternal 2× hold', () => {
    const rampRungs = rungs.slice(4)
    expect(rampRungs.length).toBe(7)
    for (let es = 2; es <= 8; es++) {
      const rung = rampRungs[es - 2]
      expect(rung.steps.length).toBe(LADDER_SPEED_PLAYLIST[es].length)
    }
    const lastRung = rampRungs[rampRungs.length - 1]
    expect(lastRung.steps).toEqual([{ kind: 'whole', text: baseRow().target_text, clips: ['turn-target'], rate: 2 }])
  })

  it('a turn with no fusible atoms resolves to zero rungs (nothing to climb)', () => {
    expect(buildTurnLadderRungs(baseRow({ atom_map_fine: [] }), opts)).toEqual([])
  })
})

describe('chunkStep — Take G unavailable for a group degrades to butted unit clips', () => {
  it('falls back to per-unit targetClipId when the group has no Take G render', () => {
    const targetClips = new Map([
      ['muy bien', 'unit-clip-1'],
      ['gracias', 'unit-clip-2'],
    ])
    const rungs = buildTurnLadderRungs(
      baseRow({ takeg_audio_ids: [null, 'take-g-2'] }),
      { glossMap, targetClipMap: targetClips, fineKnownMap },
    )
    // sentence 1's finest-unit chunk (rung 0, step 0) now butts the unit's own clip instead of slicing
    expect(rungs[0].steps[0]).toMatchObject({ kind: 'chunk', clips: ['unit-clip-1'] })
  })
})

describe('ladderViewFor — alive count → rung index, clamped to the eternal final rung', () => {
  it('maps 1-based alive counts to 0-based rung indices', () => {
    expect(ladderViewFor(1, 5)).toBe(0)
    expect(ladderViewFor(5, 5)).toBe(4)
  })
  it('clamps beyond the last rung (the eternal hold)', () => {
    expect(ladderViewFor(99, 5)).toBe(4)
  })
  it('never goes negative even for alive=0', () => {
    expect(ladderViewFor(0, 5)).toBe(0)
  })
})

describe('ladderRungToPlays — flattening a rung into scheduler-ready PodPlay entries', () => {
  const rungs = buildTurnLadderRungs(baseRow(), opts)

  it('slice clips carry takegClipId/unitStartMs/unitEndMs; audioId mirrors the clip id', () => {
    const plays = ladderRungToPlays(rungs[0], 1, 1)
    expect(plays[0]).toMatchObject({
      audioId: 'take-g-1',
      takegClipId: 'take-g-1',
      unitStartMs: 0,
      unitEndMs: 500,
      playRole: 'ps',
      sentenceIdx: 1,
      stage: 1,
    })
  })

  it('whole-clip plays (known, sentence/turn takes) carry no slice fields', () => {
    const plays = ladderRungToPlays(rungs[0], 1, 1)
    expect(plays[1].takegClipId).toBeUndefined()
    expect(plays[1].playRole).toBe('trans')
  })

  it('gapAfterMs uses the ladder gap constants and is stripped only on the rung\'s FINAL play', () => {
    const plays = ladderRungToPlays(rungs[0], 1, 1)
    expect(plays[0].gapAfterMs).toBe(700) // chunk → GAP_BETWEEN_STEPS
    expect(plays[1].gapAfterMs).toBe(500) // gloss → GAP_AFTER_GLOSS
    expect(plays[plays.length - 1].gapAfterMs).toBeUndefined()
  })

  it('the ps2x speed-ramp rung produces a play at 2× rate', () => {
    const rampRung = rungs[rungs.length - 1] // es=8: ['ps2x']
    const plays = ladderRungToPlays(rampRung, 1, 11)
    expect(plays).toEqual([{
      sentenceIdx: 1,
      stage: 11,
      playRole: 'ps2x',
      audioId: 'turn-target',
      text: baseRow().target_text,
      playbackSpeed: 2,
      glueToNextChunk: false,
    }])
  })
})
