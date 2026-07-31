import { describe, it, expect } from 'vitest'
import { compareByName, sortByName } from './alphaSort'

describe('compareByName', () => {
  it('sorts case-insensitively', () => {
    expect(['banana', 'Apple', 'cherry'].sort(compareByName)).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('sorts numerically so "Class 2" comes before "Class 10"', () => {
    expect(['Class 10', 'Class 2', 'Class 1'].sort(compareByName)).toEqual(['Class 1', 'Class 2', 'Class 10'])
  })

  it('is locale-aware for accented characters', () => {
    expect(['Émile', 'Alice', 'Bob'].sort(compareByName)).toEqual(['Alice', 'Bob', 'Émile'])
  })

  it('treats equal names as equal', () => {
    expect(compareByName('Kochi', 'Kochi')).toBe(0)
  })
})

describe('sortByName', () => {
  it('sorts objects by a name selector without mutating the input', () => {
    const input = [{ name: 'St. Mary\'s' }, { name: 'Alpha School' }, { name: 'beta School' }]
    const sorted = sortByName(input, (x) => x.name)
    expect(sorted.map((x) => x.name)).toEqual(['Alpha School', 'beta School', "St. Mary's"])
    // Original array order is untouched.
    expect(input.map((x) => x.name)).toEqual(["St. Mary's", 'Alpha School', 'beta School'])
  })

  it('returns an empty array for empty input', () => {
    expect(sortByName([], (x: { name: string }) => x.name)).toEqual([])
  })
})
