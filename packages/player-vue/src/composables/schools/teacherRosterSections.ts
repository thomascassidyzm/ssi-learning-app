/**
 * teacherRosterSections — how the Teachers page splits its staff list.
 *
 * The school-belonging design (2026-09-09,
 * docs/auth/school-belonging-design-2026-09-09.md) replaced "does this
 * person's email address sit at a domain the school claimed?" with "has
 * somebody who already holds the school given this person a class?". This
 * module is that question, applied to a roster.
 *
 * Pure and injected, the same shape as assignTeacherClasses.ts: the view
 * renders it, the tests prove it, and neither has to mount the other.
 */

export interface RosterRow {
  /** How many classes of this school they teach. Zero is the whole test. */
  classes: number
  /** When their school tag was written. Used only to order the pending. */
  joined_at?: string | null
  /**
   * SORT HINT ONLY. Whether their address sits at a domain this school has
   * claimed — derived at read time by api/school/roster.ts, stored nowhere,
   * granting nothing and blocking nothing. Null when the school claims no
   * domain, or when the row needs no sorting.
   */
  onDomain?: boolean | null
}

/** Given no classes yet, so nobody has vouched for them. */
export function isPending(row: RosterRow): boolean {
  return row.classes === 0
}

/**
 * Off-domain first, unknown next, on-domain last — so the admin's eye lands
 * on the arrival who looks least like their staff. This is the ONLY surviving
 * consequence of the claimed-domain rule, and it is cosmetic: it changes an
 * order, never an outcome.
 */
function domainRank(onDomain: boolean | null | undefined): number {
  if (onDomain === false) return 0
  if (onDomain === true) return 2
  return 1
}

/**
 * The pending arrivals, ordered. Within a domain rank, longest-waiting first:
 * an arrival nobody has claimed in a fortnight is the one worth a look.
 */
export function orderPending<T extends RosterRow>(rows: T[]): T[] {
  return rows.filter(isPending).slice().sort((a, b) => {
    const byHint = domainRank(a.onDomain) - domainRank(b.onDomain)
    if (byHint !== 0) return byHint
    return String(a.joined_at || '').localeCompare(String(b.joined_at || ''))
  })
}

/** Everyone who is teaching here, in whatever order they arrived in. */
export function settledStaff<T extends RosterRow>(rows: T[]): T[] {
  return rows.filter(r => !isPending(r))
}
