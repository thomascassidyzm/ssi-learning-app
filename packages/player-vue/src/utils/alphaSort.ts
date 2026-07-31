/**
 * The ONE comparator for structural/navigational sibling lists (schools,
 * groups, classes, teachers, rail rows…). Founder ruling (2026-07-30): same
 * data must list in the same order everywhere — default alphabetical,
 * locale-aware, case-insensitive, numeric-aware (so "Class 2" sorts before
 * "Class 10"). Route every such list through this helper instead of an ad
 * hoc `.localeCompare()` so the order can't drift apart again.
 */

export function compareByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

export function sortByName<T>(items: readonly T[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareByName(getName(a), getName(b)))
}
