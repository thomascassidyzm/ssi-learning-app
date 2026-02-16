/**
 * Tests for WI-3: Course Browser
 *
 * Tests the computational logic used by CourseBrowser.vue:
 * - BELTS constant integrity (8 belts, correct thresholds)
 * - Belt data computation (ranges, progress)
 * - Seed grid generation
 */

import { describe, it, expect } from 'vitest'
import { BELTS, getSeedFromLegoId, getBeltIndexForSeed } from '@/composables/useBeltProgress'

describe('CourseBrowser belt data', () => {
  it('BELTS has exactly 8 entries', () => {
    expect(BELTS).toHaveLength(8)
  })

  it('BELTS are in ascending threshold order', () => {
    for (let i = 1; i < BELTS.length; i++) {
      expect(BELTS[i].seedsRequired).toBeGreaterThan(BELTS[i - 1].seedsRequired)
    }
  })

  it('belt thresholds match expected values', () => {
    const expected = [0, 8, 20, 40, 80, 150, 280, 400]
    expect(BELTS.map(b => b.seedsRequired)).toEqual(expected)
  })

  it('belt names are correct', () => {
    const expected = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']
    expect(BELTS.map(b => b.name)).toEqual(expected)
  })

  it('each belt has a color defined', () => {
    for (const belt of BELTS) {
      expect(belt.color).toBeTruthy()
      expect(typeof belt.color).toBe('string')
    }
  })
})

describe('CourseBrowser belt range computation', () => {
  // Replicates the logic from CourseBrowser.vue beltData computed
  function computeBeltRanges(highestSeed: number) {
    return BELTS.map((belt, index) => {
      const nextBelt = BELTS[index + 1]
      const beltEnd = nextBelt ? nextBelt.seedsRequired - 1 : 668
      const beltStart = belt.seedsRequired === 0 ? 1 : belt.seedsRequired
      const seedCount = beltEnd - beltStart + 1

      const completedInBelt = Math.max(0, Math.min(highestSeed - beltStart + 1, seedCount))
      const progressPercent = seedCount > 0 ? Math.round((completedInBelt / seedCount) * 100) : 0

      const currentBeltIndex = getBeltIndexForSeed(highestSeed)
      const isCurrent = index === currentBeltIndex
      const isComplete = index < currentBeltIndex
      const isFuture = index > currentBeltIndex

      return {
        name: belt.name,
        beltStart,
        beltEnd,
        seedCount,
        completedInBelt,
        progressPercent,
        isCurrent,
        isComplete,
        isFuture,
      }
    })
  }

  it('white belt starts at seed 1, ends at seed 7', () => {
    const ranges = computeBeltRanges(0)
    expect(ranges[0].beltStart).toBe(1)
    expect(ranges[0].beltEnd).toBe(7)
    expect(ranges[0].seedCount).toBe(7)
  })

  it('yellow belt starts at seed 8, ends at seed 19', () => {
    const ranges = computeBeltRanges(0)
    expect(ranges[1].beltStart).toBe(8)
    expect(ranges[1].beltEnd).toBe(19)
    expect(ranges[1].seedCount).toBe(12)
  })

  it('black belt ends at seed 668', () => {
    const ranges = computeBeltRanges(0)
    const black = ranges[7]
    expect(black.beltStart).toBe(400)
    expect(black.beltEnd).toBe(668)
    expect(black.seedCount).toBe(269)
  })

  it('progress tracks correctly mid-belt', () => {
    const ranges = computeBeltRanges(12) // seed 12 = yellow belt, 5 seeds into yellow
    const yellow = ranges[1]
    expect(yellow.completedInBelt).toBe(5) // seeds 8,9,10,11,12
    expect(yellow.isCurrent).toBe(true)
    expect(yellow.isComplete).toBe(false)
  })

  it('white belt is complete when seed >= 8', () => {
    const ranges = computeBeltRanges(10)
    expect(ranges[0].isComplete).toBe(true)
    expect(ranges[0].completedInBelt).toBe(7) // All 7 seeds
    expect(ranges[0].progressPercent).toBe(100)
  })

  it('future belts have zero progress', () => {
    const ranges = computeBeltRanges(5)
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].completedInBelt).toBe(0)
      expect(ranges[i].isFuture).toBe(true)
    }
  })
})

describe('CourseBrowser seed grid generation', () => {
  // Replicates the seedsInBelt computed from CourseBrowser.vue
  function generateSeedGrid(beltStart: number, beltEnd: number, highestSeed: number) {
    const seeds = []
    for (let s = beltStart; s <= beltEnd; s++) {
      seeds.push({
        number: s,
        isCompleted: s <= highestSeed,
        isCurrent: s === highestSeed + 1,
      })
    }
    return seeds
  }

  it('generates correct seed count for white belt', () => {
    const seeds = generateSeedGrid(1, 7, 0)
    expect(seeds).toHaveLength(7)
    expect(seeds[0].number).toBe(1)
    expect(seeds[6].number).toBe(7)
  })

  it('marks completed seeds correctly', () => {
    const seeds = generateSeedGrid(1, 7, 3)
    expect(seeds[0].isCompleted).toBe(true) // seed 1
    expect(seeds[1].isCompleted).toBe(true) // seed 2
    expect(seeds[2].isCompleted).toBe(true) // seed 3
    expect(seeds[3].isCompleted).toBe(false) // seed 4
  })

  it('marks current seed (next to complete)', () => {
    const seeds = generateSeedGrid(1, 7, 3)
    expect(seeds[2].isCurrent).toBe(false) // seed 3 = completed
    expect(seeds[3].isCurrent).toBe(true)  // seed 4 = current (next)
    expect(seeds[4].isCurrent).toBe(false) // seed 5 = future
  })

  it('no current seed when all completed', () => {
    const seeds = generateSeedGrid(1, 7, 7)
    const currentSeeds = seeds.filter(s => s.isCurrent)
    expect(currentSeeds).toHaveLength(0)
  })

  it('all completed when highest is beyond belt end', () => {
    const seeds = generateSeedGrid(1, 7, 100)
    expect(seeds.every(s => s.isCompleted)).toBe(true)
  })
})
