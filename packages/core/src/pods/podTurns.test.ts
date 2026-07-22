import { describe, it, expect } from 'vitest'
import {
  computeTurnSpans,
  turnSpanForIndex,
  podPlayShowsTurnText,
  podLapPlayedSentenceIndices,
  podLapDisplayRange,
} from './podTurns'

describe('computeTurnSpans', () => {
  it('a single sentence with no glue is its own turn', () => {
    expect(computeTurnSpans([{ glue_to_next: false }])).toEqual([{ start: 0, end: 0 }])
  })

  it('glued sentences form one turn', () => {
    const sentences = [
      { glue_to_next: true },
      { glue_to_next: true },
      { glue_to_next: false },
    ]
    expect(computeTurnSpans(sentences)).toEqual([{ start: 0, end: 2 }])
  })

  it('a speaker change (glue_to_next=false) closes the turn', () => {
    const sentences = [
      { glue_to_next: false }, // turn 1: sentence 0
      { glue_to_next: true },
      { glue_to_next: false }, // turn 2: sentences 1-2
    ]
    expect(computeTurnSpans(sentences)).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 2 },
    ])
  })

  it('trailing glue_to_next=true still closes at the last sentence', () => {
    const sentences = [{ glue_to_next: true }, { glue_to_next: true }]
    expect(computeTurnSpans(sentences)).toEqual([{ start: 0, end: 1 }])
  })

  it('empty input yields no spans', () => {
    expect(computeTurnSpans([])).toEqual([])
  })
})

describe('turnSpanForIndex', () => {
  const spans = [
    { start: 0, end: 0 },
    { start: 1, end: 3 },
    { start: 4, end: 4 },
  ]

  it('finds the span containing the index', () => {
    expect(turnSpanForIndex(spans, 2)).toEqual({ start: 1, end: 3 })
  })

  it('returns null for an out-of-range index', () => {
    expect(turnSpanForIndex(spans, 99)).toBeNull()
  })
})

describe('podPlayShowsTurnText', () => {
  it('shows text for a genuine Layer-2 pod play', () => {
    expect(podPlayShowsTurnText({ isLayer1: false })).toBe(true)
    expect(podPlayShowsTurnText({})).toBe(true)
  })

  it('suppresses text for a Layer-1 listening-cup seed play', () => {
    expect(podPlayShowsTurnText({ isLayer1: true })).toBe(false)
  })

  it('suppresses text when there is no current play', () => {
    expect(podPlayShowsTurnText(null)).toBe(false)
    expect(podPlayShowsTurnText(undefined)).toBe(false)
  })
})

describe('podLapPlayedSentenceIndices', () => {
  it('returns distinct 0-based sentence indices in order, deduping repeated stages', () => {
    const plays = [
      { sentenceIdx: 1, playRole: 'ps' },
      { sentenceIdx: 1, playRole: 'trans' },
      { sentenceIdx: 1, playRole: 'ps' },
      { sentenceIdx: 2, playRole: 'ps' },
    ]
    expect(podLapPlayedSentenceIndices(plays)).toEqual([0, 1])
  })

  it('excludes Layer-1 segued plays (they index a different catalogue)', () => {
    const plays = [
      { sentenceIdx: 5, isLayer1: true },
      { sentenceIdx: 1, isLayer1: false },
    ]
    expect(podLapPlayedSentenceIndices(plays)).toEqual([0])
  })

  it('empty plays yields no indices', () => {
    expect(podLapPlayedSentenceIndices([])).toEqual([])
  })
})

describe('podLapDisplayRange', () => {
  it('a single-sentence lap early in the dialogue shows just that sentence plus one trailing neighbour', () => {
    // "the first phrase is just Buongiorno, Sarah — and not much else"
    expect(podLapDisplayRange(12, [0])).toEqual({ start: 0, end: 1 })
  })

  it('widens by at most one neighbour on each side of a multi-sentence lap', () => {
    expect(podLapDisplayRange(12, [3, 4, 5])).toEqual({ start: 2, end: 6 })
  })

  it('clips the neighbour window at the sentence-list bounds', () => {
    expect(podLapDisplayRange(3, [0, 1, 2])).toEqual({ start: 0, end: 2 })
  })

  it('returns null when nothing has played yet', () => {
    expect(podLapDisplayRange(12, [])).toBeNull()
  })

  it('returns null when there are no sentences at all', () => {
    expect(podLapDisplayRange(0, [0])).toBeNull()
  })
})
