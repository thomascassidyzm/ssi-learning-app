/**
 * beltBands — the belt percentage the class Course journey tile shows.
 *
 * What is pinned here: the denominator is the number of the course's OWN legos
 * inside the current belt's seed band, counted from rows read at request time,
 * and the ladder cannot drift away from the app's (Tom, 2026-09-17: a guessed
 * percentage on a teacher's screen is worse than none).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BELT_MINS, beltIndexOfSeed, beltProgress } from './beltBands'

describe('beltBands', () => {
  it('reads the same ladder as the app belts.ts', () => {
    const src = readFileSync(
      join(process.cwd(), 'packages/player-vue/src/composables/schools/belts.ts'),
      'utf8',
    )
    const rungs = [...src.matchAll(/key:\s*'(\w+)',\s*min:\s*(\d+)/g)].map((m) => ({ key: m[1], min: Number(m[2]) }))
    expect(rungs.length).toBe(BELT_MINS.length)
    expect(rungs).toEqual(BELT_MINS.map((b) => ({ key: b.key, min: b.min })))
  })

  it('puts a seed in its band', () => {
    expect(BELT_MINS[beltIndexOfSeed(0)].key).toBe('white')
    expect(BELT_MINS[beltIndexOfSeed(7)].key).toBe('white')
    expect(BELT_MINS[beltIndexOfSeed(8)].key).toBe('yellow')
    expect(BELT_MINS[beltIndexOfSeed(19)].key).toBe('yellow')
    expect(BELT_MINS[beltIndexOfSeed(20)].key).toBe('orange')
    expect(BELT_MINS[beltIndexOfSeed(999)].key).toBe('black')
  })

  it('counts the band from the course, not from a constant', () => {
    // Two legos per seed, seeds 1..24: white holds seeds 1-7 (14 legos),
    // yellow seeds 8-19 (24 legos), orange seeds 20-24 (10 legos).
    const seeds: number[] = []
    for (let s = 1; s <= 24; s++) { seeds.push(s); seeds.push(s) }
    // Reached the first lego of seed 14 — index 26, the third lego of the
    // yellow band, which runs from index 14.
    const p = beltProgress(seeds, 26)
    expect(p).toEqual({ belt: 'yellow', name: 'Yellow', done: 13, total: 24 })
    // A shorter course truncates the band, and the denominator follows it.
    expect(beltProgress(seeds.slice(0, 30), 26)).toEqual({ belt: 'yellow', name: 'Yellow', done: 13, total: 16 })
  })

  it('says nothing for a class that has never played', () => {
    expect(beltProgress([1, 1, 2], -1)).toBeNull()
    expect(beltProgress([], 0)).toBeNull()
  })
})
