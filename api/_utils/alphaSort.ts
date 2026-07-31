/**
 * The ONE comparator for structural/navigational sibling lists served by the
 * groups/schools API (children, siblings, "All schools"/"All groups" lenses,
 * class rosters…). Founder ruling (2026-07-30): same data must list in the
 * same order everywhere — default alphabetical, locale-aware, case-
 * insensitive, numeric-aware. Mirrors packages/player-vue/src/utils/alphaSort.ts
 * (api/ and player-vue/ are separate packages with no shared runtime, so the
 * ~4-line comparator is duplicated rather than pulling in a shared package
 * for one function — cheaper than the build-graph cost of a new workspace dep).
 */

export function compareByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

export function sortByName<T>(items: readonly T[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareByName(getName(a), getName(b)))
}
