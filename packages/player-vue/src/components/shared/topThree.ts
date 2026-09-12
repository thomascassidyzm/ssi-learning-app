/**
 * topThree — THE ONE expand idiom for every list on the schools surfaces
 * (Tom, 2026-09-12: "maybe the top three rows in each and then an expand to
 * show all, a bit like the concept of enough to know what's in this section
 * but not so much that it's just noise").
 *
 * A list renders its first three rows and one control that shows the rest;
 * the control collapses back. Under three rows there is nothing to hide, so
 * no control renders at all — nothing is ever hidden without a way to show it.
 * Kept as a pure function so the rule is provable once and reused everywhere
 * rather than re-derived in each template.
 */
export const TOP_THREE = 3

export interface TopThree<T> {
  /** The rows to render: everything, or the first three. */
  shown: T[]
  /** How many rows the control is hiding right now. */
  hidden: number
  /** Whether a control belongs on this list at all — more than three rows. */
  collapsible: boolean
}

export function topThree<T>(rows: readonly T[], showAll: boolean, cap = TOP_THREE): TopThree<T> {
  const collapsible = rows.length > cap
  const shown = collapsible && !showAll ? rows.slice(0, cap) : [...rows]
  return { shown, hidden: rows.length - shown.length, collapsible }
}
