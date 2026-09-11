import { describe, it, expect } from 'vitest'
import { formatWithUnit, singulariseUnit } from './units'

describe('formatWithUnit', () => {
  it('singularises the unit at a value of one — the "1 people" bug', () => {
    expect(formatWithUnit(1, 'people')).toBe('1 person')
    expect(formatWithUnit(3, 'people')).toBe('3 people')
  })

  it('leaves percentages tight to the number', () => {
    expect(formatWithUnit(1, '%')).toBe('1%')
    expect(formatWithUnit(12.25, '%')).toBe('12.3%')
  })

  it('formats integers plain and fractions to one decimal', () => {
    expect(formatWithUnit(4, 'hours')).toBe('4 hours')
    expect(formatWithUnit(4.52, 'hours')).toBe('4.5 hours')
    expect(formatWithUnit(7)).toBe('7')
  })
})

describe('singulariseUnit', () => {
  it('handles regular plurals', () => {
    expect(singulariseUnit('days')).toBe('day')
    expect(singulariseUnit('entries')).toBe('entry')
    expect(singulariseUnit('classes')).toBe('class')
  })

  it('leaves short abbreviations alone', () => {
    expect(singulariseUnit('ms')).toBe('ms')
    expect(singulariseUnit('s')).toBe('s')
    expect(singulariseUnit('hrs')).toBe('hrs')
  })

  it('leaves units that are not plural alone', () => {
    expect(singulariseUnit('per person')).toBe('per person')
    expect(singulariseUnit('LEGOs')).toBe('LEGO')
  })
})
