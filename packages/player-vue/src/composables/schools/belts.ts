/**
 * Canonical belt thresholds for the schools dashboards.
 *
 * These MUST match the learner-app belt ladder (useBeltProgress.ts):
 *   White 0 · Yellow 8 · Orange 20 · Green 40 · Blue 80 · Purple 150 · Brown 280 · Black 400
 *
 * Before 2026-06-11 the schools views each carried their own copy of a belt
 * mapper, and they had drifted: some skipped Purple (150) and Brown (280)
 * entirely, others used shifted thresholds (20/40/80/150/280) so every belt
 * above white was understated and the same student showed a different belt on
 * different screens. One source of truth now; the colour tokens
 * (--schools-belt-*) already cover all eight belts.
 */
export type Belt =
  | 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'brown' | 'black'

// Alias for the views that call the union `BeltName`.
export type BeltName = Belt

export interface BeltTier {
  name: string // Title-case label for display
  key: Belt
  min: number // minimum seeds_completed to reach this belt
}

export const BELTS: BeltTier[] = [
  { name: 'White',  key: 'white',  min: 0 },
  { name: 'Yellow', key: 'yellow', min: 8 },
  { name: 'Orange', key: 'orange', min: 20 },
  { name: 'Green',  key: 'green',  min: 40 },
  { name: 'Blue',   key: 'blue',   min: 80 },
  { name: 'Purple', key: 'purple', min: 150 },
  { name: 'Brown',  key: 'brown',  min: 280 },
  { name: 'Black',  key: 'black',  min: 400 },
]

/** Map a seeds-completed count to its belt. */
export function deriveBelt(seeds: number): Belt {
  let i = BELTS.length - 1
  while (i > 0 && seeds < BELTS[i].min) i--
  return BELTS[i].key
}
