// ============================================================================
// beltBands — how far through the current belt a class is, in NEW PHRASES.
//
// The belt ladder is a ladder of SEEDS (packages/player-vue/src/composables/
// schools/belts.ts, which is itself the learner app's ladder). A belt is
// therefore a BAND of seeds, and the figure the Course journey card wants is
// the new phrases — the course's legos — whose seed falls inside that band:
// how many the class has reached, out of how many the band holds.
//
// The count is taken over the course's OWN legos as read at request time
// (course_legos), never a constant: a denominator nobody can trace is worse on
// a teacher's screen than no percentage at all (Tom, 2026-09-17).
//
// BELT_MINS must match belts.ts. beltBands.test.ts asserts it against that
// file, so the two cannot drift apart silently.
// ============================================================================

export interface BeltMin { key: string; name: string; min: number }

export const BELT_MINS: BeltMin[] = [
  { key: 'white', name: 'White', min: 0 },
  { key: 'yellow', name: 'Yellow', min: 8 },
  { key: 'orange', name: 'Orange', min: 20 },
  { key: 'green', name: 'Green', min: 40 },
  { key: 'blue', name: 'Blue', min: 80 },
  { key: 'purple', name: 'Purple', min: 150 },
  { key: 'brown', name: 'Brown', min: 280 },
  { key: 'black', name: 'Black', min: 400 },
]

/** The index in BELT_MINS of the belt a seed number sits in. */
export function beltIndexOfSeed(seed: number): number {
  let i = BELT_MINS.length - 1
  while (i > 0 && seed < BELT_MINS[i].min) i--
  return i
}

export interface BeltProgress {
  /** Belt key, e.g. 'yellow' — the same keys the schools belt tokens use. */
  belt: string
  /** Title-case belt name, for a sentence a teacher reads. */
  name: string
  /** New phrases inside this belt's seed band the class has reached. */
  done: number
  /** New phrases the band holds in total, counted from the live course. */
  total: number
}

/**
 * Where a class stands inside its current belt, counted in legos.
 *
 * `seeds` is the seed number of every lego in course order; `reachedIndex` is
 * the index of the furthest lego the class has reached, or -1 for a class that
 * has never played. Returns null when there is nothing honest to say.
 */
export function beltProgress(seeds: number[], reachedIndex: number): BeltProgress | null {
  if (reachedIndex < 0 || reachedIndex >= seeds.length) return null
  const bi = beltIndexOfSeed(seeds[reachedIndex])
  const lo = BELT_MINS[bi].min
  const hi = bi + 1 < BELT_MINS.length ? BELT_MINS[bi + 1].min : Infinity
  let total = 0
  let done = 0
  for (let i = 0; i < seeds.length; i++) {
    if (seeds[i] < lo || seeds[i] >= hi) continue
    total++
    if (i <= reachedIndex) done++
  }
  if (!total) return null
  return { belt: BELT_MINS[bi].key, name: BELT_MINS[bi].name, done, total }
}
