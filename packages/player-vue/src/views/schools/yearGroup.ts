/**
 * yearGroup — the ONE rule behind the year-group tiles under the headline
 * numbers on the leader home (NodeHomeView.vue) and the classes page
 * (TeacherDashboard.vue), kept pure so it is proven once (job #306, Option A
 * from the #303 review; Tom, 2026-09-12: "build Option A").
 *
 * Year group is DERIVED ON SCREEN from the class name and never stored or sent
 * anywhere: a leading number from 6 to 13, optionally after "Year", "Yr" or
 * "Y", followed by anything that is not another digit. So "7B", "8H", "Year 9
 * French", "10 Set 1", "10a1 LJ", "9b/KW LJ" and "Y7 Welsh" parse; "1 AJ
 * Admin" stays out of a phantom Year 1, and "B8" and "Rachel Tiller Cleaves
 * Personal" do not parse at all. Names that do not parse fall into one Other
 * tile. A school where fewer than half the names parse falls back to per-class
 * tiles instead, because a row of "Other" is not a breakdown.
 *
 * Each tile carries only numbers the page already fetched for its classes:
 * IN-APP MINUTES this week summed across the group's classes (job #766, Tom
 * 2026-09-15: the tiles read as minutes under a headline in minutes, so they
 * are minutes — the same per-class figure as the class rows, rounded up per
 * class by practiceMinutes.ts), classes practising this week out of classes
 * in the group, and phrases practised this week, kept on the tile data for
 * anyone who still wants them.
 */
export const YEAR_MIN = 6
export const YEAR_MAX = 13

const LEADING_YEAR = /^\s*(?:year|yr|y)?\s*(\d{1,2})(?!\d)/i

export function parseYearGroup(name: string): number | null {
  const m = LEADING_YEAR.exec(name || '')
  if (!m) return null
  const n = Number(m[1])
  return n >= YEAR_MIN && n <= YEAR_MAX ? n : null
}

export interface YearGroupClass {
  id: string
  name: string
  /** The class account's own in-app minutes this week — the class row's figure, already rounded up. */
  minutes7d: number
  /** Phrases practised in whole-class play this week — from the payload the page already holds. */
  phrases7d: number
  /** Whether the class counts as practising this week, by the headline's own rule. */
  practising: boolean
}

export interface YearGroupTile {
  /** 'year' tiles carry a year; the one 'other' tile and per-class tiles carry null. */
  key: string
  year: number | null
  /** Per-class fallback: the class's own name. */
  name: string | null
  classCount: number
  practising: number
  /** In-app minutes this week, summed across the tile's classes — the big number. */
  minutes7d: number
  phrases7d: number
}

export interface YearGroupBreakdown {
  /** 'year' = one tile per year group plus Other; 'class' = per-class tiles, because fewer than half the names parse. */
  mode: 'year' | 'class'
  tiles: YearGroupTile[]
}

export function yearGroupBreakdown(classes: readonly YearGroupClass[]): YearGroupBreakdown {
  if (classes.length === 0) return { mode: 'year', tiles: [] }
  const parsed = classes.map((c) => ({ c, year: parseYearGroup(c.name) }))
  const parsedCount = parsed.filter((p) => p.year !== null).length
  if (parsedCount * 2 < classes.length) {
    // Fewer than half parse: per-class tiles, busiest first — by minutes in
    // the app, the activity every school list defaults to (job #766) — so the
    // row still says who is doing it.
    const tiles = [...classes]
      .sort((a, b) => b.minutes7d - a.minutes7d || b.phrases7d - a.phrases7d || a.name.localeCompare(b.name))
      .map((c) => ({ key: `class:${c.id}`, year: null, name: c.name, classCount: 1, practising: c.practising ? 1 : 0, minutes7d: c.minutes7d, phrases7d: c.phrases7d }))
    return { mode: 'class', tiles }
  }
  const byYear = new Map<number | null, YearGroupTile>()
  for (const { c, year } of parsed) {
    const key = year === null ? 'other' : `year:${year}`
    const tile = byYear.get(year) ?? { key, year, name: null, classCount: 0, practising: 0, minutes7d: 0, phrases7d: 0 }
    tile.classCount += 1
    tile.practising += c.practising ? 1 : 0
    tile.minutes7d += c.minutes7d
    tile.phrases7d += c.phrases7d
    byYear.set(year, tile)
  }
  const tiles = [...byYear.values()].sort((a, b) => {
    // Years ascending, Other last.
    if (a.year === null) return 1
    if (b.year === null) return -1
    return a.year - b.year
  })
  return { mode: 'year', tiles }
}

/** The headline's own rule for "practising this week": last practised inside the window. */
export function practisedWithin(lastPractisedAt: string | null | undefined, windowDays = 7, now = Date.now()): boolean {
  if (!lastPractisedAt) return false
  const t = new Date(lastPractisedAt).getTime()
  return Number.isFinite(t) && now - t <= windowDays * 86400000
}
