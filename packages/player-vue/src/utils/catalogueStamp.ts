/**
 * The courses catalogue's vintage — the one cheap question a repeat boot asks
 * instead of re-downloading 83 course rows.
 *
 * The catalogue read is the first network dependency of every boot. Job #117
 * measured it at 17.8 KB going over the wire on EVERY load including repeats,
 * which made it the single largest thing on a repeat visit at phone width on
 * 4G — for a row set that changes when a course is published or edited and not
 * otherwise. So App.vue mirrors the rows in localStorage, stamps the mirror
 * with its vintage, and on the next boot asks only whether that vintage still
 * stands (~200 bytes), refetching the rows only when it has moved.
 *
 * Lives here rather than inside App.vue so the decision is testable without
 * mounting the app.
 */

/** What the stamp query asks for: newest row first, with an exact row count. */
export interface CatalogueStampResult {
  data?: Array<{ updated_at?: string | null }> | null
  count?: number | null
  error?: unknown
}

/**
 * The stamp a stamp-query result carries, or null if it did not land.
 *
 * `<row count>:<newest updated_at>`. Both halves are needed and neither is
 * enough alone: editing a course moves its `updated_at`, so the newest one
 * moves; publishing or withdrawing one changes the COUNT even when the row that
 * left was not the newest. Compared for equality, never for order — a
 * withdrawal can move the newest `updated_at` BACKWARDS, and that is still a
 * change.
 */
export function catalogueStampOf(res: CatalogueStampResult | null | undefined): string | null {
  if (!res || res.error || !Array.isArray(res.data)) return null
  if (typeof res.count !== 'number') return null
  return `${res.count}:${res.data[0]?.updated_at ?? ''}`
}

/**
 * Serve the mirror, or pay for the rows?
 *
 *  - no mirror, or a mirror with no stamp (written by an older build): `fetch`;
 *  - stamp unchanged: `mirror`;
 *  - stamp unreachable — offline, timed out, errored: `mirror`. This is the
 *    case that already served the mirror before any of this existed, and a
 *    stale catalogue offline is correct;
 *  - stamp moved: `fetch`.
 */
export function decideCatalogueRead(args: {
  hasMirror: boolean
  mirroredStamp: string | null
  liveStamp: string | null
}): 'mirror' | 'fetch' {
  if (!args.hasMirror || !args.mirroredStamp) return 'fetch'
  if (!args.liveStamp) return 'mirror'
  return args.liveStamp === args.mirroredStamp ? 'mirror' : 'fetch'
}
