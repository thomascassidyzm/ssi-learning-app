import { describe, it, expect } from 'vitest'
import {
  buildMainStage,
  type PodSentenceRow,
} from './podStageComposition'

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
