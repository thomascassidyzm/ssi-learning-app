import { describe, it, expect } from 'vitest'
import { parseLegoPosition, formatFurthestPoint, canRecoverToFurthest } from './furthestProgress'

describe('parseLegoPosition', () => {
  it('parses a well-formed lego id', () => {
    expect(parseLegoPosition('S0044L03')).toEqual({ seed: 44, legoIndex: 3 })
  })

  it('parses multi-digit lego indices', () => {
    expect(parseLegoPosition('S0600L12')).toEqual({ seed: 600, legoIndex: 12 })
  })

  it('returns null for null/malformed input', () => {
    expect(parseLegoPosition(null)).toBeNull()
    expect(parseLegoPosition('')).toBeNull()
    expect(parseLegoPosition('not-a-lego-id')).toBeNull()
    expect(parseLegoPosition('S44L3')).toBeNull()
  })
})

describe('formatFurthestPoint', () => {
  it('formats a valid lego id', () => {
    expect(formatFurthestPoint('S0044L03')).toBe('Seed 44 / Lego 3')
  })

  it('returns null when there is nothing to show', () => {
    expect(formatFurthestPoint(null)).toBeNull()
    expect(formatFurthestPoint('garbage')).toBeNull()
  })
})

describe('canRecoverToFurthest', () => {
  it('is true when the ceiling is ahead of the cursor', () => {
    expect(canRecoverToFurthest('S0002L01', 'S0044L03')).toBe(true)
  })

  it('is true when the cursor is missing entirely (lost cursor) but a ceiling exists', () => {
    expect(canRecoverToFurthest(null, 'S0044L03')).toBe(true)
  })

  it('is false when there is no ceiling', () => {
    expect(canRecoverToFurthest('S0002L01', null)).toBe(false)
    expect(canRecoverToFurthest(null, null)).toBe(false)
  })

  it('is false when the ceiling already matches the cursor (nothing to recover)', () => {
    expect(canRecoverToFurthest('S0044L03', 'S0044L03')).toBe(false)
  })
})
