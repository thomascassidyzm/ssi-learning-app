import { describe, it, expect } from 'vitest'
import { computeTurnSpans, turnSpanForIndex, podPlayShowsTurnText } from './podTurns'

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
