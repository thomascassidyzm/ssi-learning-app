import { describe, it, expect } from 'vitest'
import {
  buildMainStage,
  composeSentenceArc,
  type PodSentenceRow,
} from './podStageComposition'
import { DEFAULT_STAGE0 } from './stage0Sequence'

const baseSentence = (over: Partial<PodSentenceRow> = {}): PodSentenceRow => ({
  global_order: 1,
  target_text: 'Nǐ hǎo',
  known_text: 'Hello',
  target_audio_id: 'tgt1',
  known_audio_id: 'kn1',
  explainer_audio_id: null,
  glue_to_next: false,
  atom_map: null,
  ...over,
})

describe('buildMainStage — whole-sentence stage composition', () => {
  it('falls back explainer → translation when the sentence has no explainer clip', () => {
    const plays = buildMainStage(baseSentence(), 1, 1, ['ps', 'explainer', 'ps'])
    expect(plays.map((p) => p.playRole)).toEqual(['ps', 'trans', 'ps'])
    expect(plays[1].audioId).toBe('kn1') // the translation clip stands in
  })

  it('uses the explainer clip when present', () => {
    const plays = buildMainStage(baseSentence({ explainer_audio_id: 'exp1' }), 1, 1, ['ps', 'explainer', 'ps'])
    expect(plays.map((p) => p.playRole)).toEqual(['ps', 'explainer', 'ps'])
    expect(plays[1].audioId).toBe('exp1')
  })

  it('never ends on the known language — appends a target close after a trailing trans', () => {
    const plays = buildMainStage(baseSentence(), 2, 1, ['ps', 'trans'])
    expect(plays.map((p) => p.playRole)).toEqual(['ps', 'trans', 'ps'])
    expect(plays[plays.length - 1].audioId).toBe('tgt1')
  })

  it('drops a trans slot when the sentence has no known clip', () => {
    const plays = buildMainStage(baseSentence({ known_audio_id: null }), 2, 1, ['ps', 'trans', 'ps'])
    expect(plays.map((p) => p.playRole)).toEqual(['ps', 'ps'])
  })
})

describe('composeSentenceArc — the Progression walk = main-flow by construction', () => {
  const stagePlaylist = { 1: ['ps', 'explainer', 'ps'], 2: ['ps', 'trans', 'ps'] } as const
  const glossMap = new Map([['L1', 'gloss1']])
  const targetClipMap = new Map([['Nǐ hǎo', 'atom1']])

  it('prepends the Stage-0 ladder when the sentence resolves to atoms with a clip', () => {
    const sentence = baseSentence({
      atom_map: [{ lego_key: 'L1', kind: 'atom', gloss: 'hello', target_surface: 'Nǐ hǎo' }],
    })
    const arc = composeSentenceArc(sentence, 1, { stage0: DEFAULT_STAGE0, glossMap, targetClipMap, stagePlaylist })
    const stage0Plays = arc.filter((p) => p.stage === 0)
    expect(stage0Plays.length).toBeGreaterThan(0)
    // Stage-0 comes FIRST, before any main stage.
    const firstMainIdx = arc.findIndex((p) => p.stage > 0)
    expect(arc.slice(0, firstMainIdx).every((p) => p.stage === 0)).toBe(true)
  })

  it('omits Stage-0 when the sentence has no atoms (matches main-flow gate)', () => {
    const arc = composeSentenceArc(baseSentence(), 1, { stage0: DEFAULT_STAGE0, glossMap, targetClipMap, stagePlaylist })
    expect(arc.some((p) => p.stage === 0)).toBe(false)
    expect(arc.some((p) => p.stage === 1)).toBe(true)
  })

  it('each main-stage slice equals buildMainStage — the same builder the scheduler runs', () => {
    const sentence = baseSentence({
      atom_map: [{ lego_key: 'L1', kind: 'atom', gloss: 'hello', target_surface: 'Nǐ hǎo' }],
    })
    const arc = composeSentenceArc(sentence, 1, { stage0: DEFAULT_STAGE0, glossMap, targetClipMap, stagePlaylist })
    for (const stage of [1, 2]) {
      const slice = arc.filter((p) => p.stage === stage)
      expect(slice).toEqual(buildMainStage(sentence, stage, 1, stagePlaylist[stage as 1 | 2] as any))
    }
  })

  it('contributes nothing when the sentence has no target audio', () => {
    const arc = composeSentenceArc(baseSentence({ target_audio_id: null }), 1, { stage0: DEFAULT_STAGE0, glossMap, targetClipMap, stagePlaylist })
    expect(arc).toEqual([])
  })
})
