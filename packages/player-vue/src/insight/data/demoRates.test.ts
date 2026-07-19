import { describe, it, expect } from 'vitest'
import {
  HERO_RATES,
  getRateComparison,
  listEntities,
  listAverages,
  listEntityLevels,
  WINDOW_OPTIONS,
  DEFAULT_WINDOW,
} from './demoRates'

describe('demoRates — the "entity vs average" rate fixtures', () => {
  it('ships the 6 hero rates with progressPace first (the headline rate)', () => {
    expect(HERO_RATES).toHaveLength(6)
    expect(HERO_RATES[0].id).toBe('progressPace')
    const ids = HERO_RATES.map((m) => m.id)
    expect(ids).toEqual([
      'progressPace', 'appMinutesDay', 'newLegosHr',
      'repeatsRatio', 'interactionsMin', 'daysActiveWk',
    ])
  })

  it('every hero rate declares unit, per, and levels ⊆ the canonical set', () => {
    const allowed = new Set(['learner', 'class', 'school', 'course'])
    for (const m of HERO_RATES) {
      expect(m.unit.length).toBeGreaterThan(0)
      expect(m.per.length).toBeGreaterThan(0)
      expect(m.entityLevels.length).toBeGreaterThan(0)
      expect(m.entityLevels.every((l) => allowed.has(l)))
        .toBe(true)
    }
  })

  it('lists a real roster per (metric, level)', () => {
    const opts = listEntities('progressPace', 'class')
    expect(opts.length).toBeGreaterThanOrEqual(8)
    expect(opts[0].label.length).toBeGreaterThan(0)
    // a level the metric does not declare lists nothing
    expect(listEntities('appMinutesDay', 'course')).toEqual([])
  })

  it('compare-to = the ANCESTOR chain, nearest first, naming the ancestor', () => {
    const classes = listEntities('progressPace', 'class')
    const luimnigh = classes.find((c) => c.label.startsWith('Gaelcholáiste Luimnigh'))!
    const avgs = listAverages('progressPace', 'class', luimnigh.value)
    // nearest ancestor (the school) first — the default
    expect(avgs[0].value).toBe('school')
    expect(avgs[0].label).toBe('Gaelcholáiste Luimnigh avg')
    expect(avgs[1].value).toBe('course')
    expect(avgs.length).toBeGreaterThanOrEqual(2)

    // learner chain: class → school → course
    const learner = listEntities('progressPace', 'learner')[0]
    const learnerAvgs = listAverages('progressPace', 'learner', learner.value)
    expect(learnerAvgs.map((a) => a.value)).toEqual(['class', 'school', 'course'])
  })

  it('the cohort is SIBLINGS at the entity level (entity excluded), never its own members', () => {
    const classes = listEntities('progressPace', 'class')
    const luimnigh = classes.find((c) => c.label === 'Gaelcholáiste Luimnigh · Rang a 1 — Sínis')!
    const out = getRateComparison('progressPace', 'class', luimnigh.value, 'school')
    // Gaelcholáiste Luimnigh carries 3 classes → 2 siblings
    expect(out.distribution.values).toHaveLength(2)
    expect(out.cohortLabel).toBe('classes in Gaelcholáiste Luimnigh')
    // sibling mean, not a mean that includes the entity
    const [a, b] = out.distribution.values
    expect(Math.abs(out.average.value - (a + b) / 2)).toBeLessThanOrEqual(0.051) // 1dp rounding
  })

  it('speaks AS the entity — subject named, never the viewer', () => {
    const classes = listEntities('progressPace', 'class')
    const luimnigh = classes.find((c) => c.label === 'Gaelcholáiste Luimnigh · Rang a 1 — Sínis')!
    const out = getRateComparison('progressPace', 'class', luimnigh.value, 'school')
    expect(out.subject).toBe('Rang a 1 — Sínis')
    expect(out.subjectIsViewer).toBe(false)
    expect(out.levelNoun).toBe('class')
    expect(out.average.label).toBe('Gaelcholáiste Luimnigh avg')
  })

  it('is deterministic — the same selection yields the identical comparison twice', () => {
    const id = listEntities('progressPace', 'class')[2].value
    const a = getRateComparison('progressPace', 'class', id, 'school')
    const b = getRateComparison('progressPace', 'class', id, 'school')
    expect(a).toEqual(b)
  })

  it('an entity keeps the same value in every scope it is compared within', () => {
    const id = listEntities('progressPace', 'class')[0].value
    const school = getRateComparison('progressPace', 'class', id, 'school')
    const course = getRateComparison('progressPace', 'class', id, 'course')
    expect(school.entity.value).toBe(course.entity.value)
    expect(school.entity.trend).toEqual(course.entity.trend)
  })

  it('returns a well-formed, internally-coherent comparison', () => {
    const opts = listEntities('progressPace', 'class')
    const out = getRateComparison('progressPace', 'class', opts[0].value, 'course')
    expect(out.metricLabel).toBe('Rate of progress')
    expect(out.unit).toBe('LEGOs')
    expect(out.per).toBe('week')
    // default window (30d) = 30 daily points
    expect(out.entity.trend).toHaveLength(30)
    expect(out.average.trend).toHaveLength(30)
    expect(out.percentile).toBeGreaterThanOrEqual(0)
    expect(out.percentile).toBeLessThanOrEqual(100)
    const expectUp = out.entity.value >= out.average.value
    expect(out.deltaPct >= 0).toBe(expectUp)
    // quartile band ordered; entity + average marked
    const d = out.distribution
    expect(d.min).toBeLessThanOrEqual(d.q1)
    expect(d.q1).toBeLessThanOrEqual(d.median)
    expect(d.median).toBeLessThanOrEqual(d.q3)
    expect(d.q3).toBeLessThanOrEqual(d.max)
    expect(d.entityValue).toBe(out.entity.value)
    expect(d.averageValue).toBe(out.average.value)
    for (let i = 1; i < d.values.length; i++) {
      expect(d.values[i - 1]).toBeLessThanOrEqual(d.values[i])
    }
  })

  it('returns an ANONYMISED distribution (no other-entity identities anywhere)', () => {
    const opts = listEntities('progressPace', 'class')
    const out = getRateComparison('progressPace', 'class', opts[0].value, 'course')
    expect(out.distribution.values.every((v) => typeof v === 'number')).toBe(true)
    const serialised = JSON.stringify(out)
    for (const o of opts) {
      if (o.label === 'Gaelscoil Cholmcille · Rang a 4 — Sínis' && opts[0].value === o.value) continue
      if (o.value === opts[0].value) continue // the entity itself may appear
      // no OTHER class's full label leaks
      expect(serialised).not.toContain(o.label)
    }
  })

  it('contextLine carries the LEGO\'s own content, never raw S/L position ids', () => {
    const withPos = getRateComparison(
      'progressPace', 'class', listEntities('progressPace', 'class')[0].value, 'school',
    )
    expect(withPos.contextLine).toMatch(/^Furthest LEGO · ".+" — ".+"$/)
    expect(withPos.contextLine).not.toMatch(/S\d+ · L\d+/)

    const withoutPos = getRateComparison(
      'appMinutesDay', 'class', listEntities('appMinutesDay', 'class')[0].value, 'school',
    )
    expect(withoutPos.contextLine).toBeUndefined()
  })

  it('falls back gracefully on unknown metric / entity / average (never throws)', () => {
    const bad = getRateComparison('nope', 'class', 'x', 'school')
    expect(bad.distribution.values).toEqual([])
    expect(() => getRateComparison('nope', 'class', 'x', 'school')).not.toThrow()

    // unknown entity id → falls back to the first roster entity, still coherent
    const out = getRateComparison('progressPace', 'class', 'does-not-exist', 'school')
    expect(out.distribution.values.length).toBeGreaterThan(0)
    expect(out.entity.label.length).toBeGreaterThan(0)

    // unknown average → falls back to the NEAREST ancestor (the default)
    const id = listEntities('progressPace', 'class')[0].value
    const avg = getRateComparison('progressPace', 'class', id, 'not-a-scope')
    expect(avg.average.label).toBe(listAverages('progressPace', 'class', id)[0].label)
  })

  it('listEntityLevels mirrors the hero-rate definitions', () => {
    expect(listEntityLevels('progressPace')).toEqual(HERO_RATES[0].entityLevels)
    expect(listEntityLevels('nope')).toEqual([])
  })

  // ── Windows (rolling day units, founder ruling 2026-07-19, demo parity) ────
  it('ships the 4 rolling windows with 30d as the default', () => {
    expect(WINDOW_OPTIONS.map((w) => w.value)).toEqual(['today', '7d', '30d', 'all'])
    expect(WINDOW_OPTIONS.map((w) => w.label)).toEqual(['Today', 'Last 7 days', 'Last 30 days', 'All time'])
    expect(DEFAULT_WINDOW).toBe('30d')
  })

  it('defaults to 30d when window is omitted — 30 daily trend points', () => {
    const id = listEntities('progressPace', 'class')[0].value
    const out = getRateComparison('progressPace', 'class', id, 'school')
    expect(out.entity.trend).toHaveLength(30)
    expect(out.average.trend).toHaveLength(30)
    expect(out.windowLabel).toBe('Last 30 days')
    expect(out.trendPeriodDays).toBe(1)
  })

  it('a non-default window (7d) reshapes the trend to daily points, coherently for a non-default measure', () => {
    const classes = listEntities('appMinutesDay', 'class')
    const id = classes[0].value
    const out = getRateComparison('appMinutesDay', 'class', id, 'school', '7d')
    expect(out.entity.trend).toHaveLength(7)
    expect(out.average.trend).toHaveLength(7)
    expect(out.windowLabel).toBe('Last 7 days')
    expect(out.trendLabel).toBe('Daily · last 7 days')
    expect(out.trendPeriodDays).toBe(1)
    // still coherent: same voice/cohort contract as the default window
    expect(out.metricLabel).toBe('App-minutes')
    expect(out.subjectIsViewer).toBe(false)
    expect(out.cohortLabel?.length).toBeGreaterThan(0)
  })

  it('all four windows stay internally coherent (point count matches trendPeriodDays\' spacing)', () => {
    const id = listEntities('progressPace', 'class')[0].value
    const expectedPoints: Record<string, number> = { today: 24, '7d': 7, '30d': 30, all: 12 }
    const expectedDays: Record<string, number> = { today: 1 / 24, '7d': 1, '30d': 1, all: 30 }
    for (const w of WINDOW_OPTIONS) {
      const out = getRateComparison('progressPace', 'class', id, 'school', w.value)
      expect(out.entity.trend).toHaveLength(expectedPoints[w.value])
      expect(out.trendPeriodDays).toBeCloseTo(expectedDays[w.value])
      expect(out.windowLabel).toBe(w.label)
    }
  })

  it('under Today, a per-week rate presents honestly in per-day form (headline + cohort together)', () => {
    const id = listEntities('progressPace', 'class')[0].value
    const monthly = getRateComparison('progressPace', 'class', id, 'school', '30d')
    const today = getRateComparison('progressPace', 'class', id, 'school', 'today')
    expect(monthly.per).toBe('week')
    expect(today.per).toBe('day')
    expect(today.entity.value).toBeCloseTo(monthly.entity.value / 7, 1)
    expect(today.distribution.entityValue).toBe(today.entity.value)
    expect(today.distribution.averageValue).toBe(today.average.value)
  })

  it('old window values alias forward; an unknown window falls back to the default, never throws', () => {
    const id = listEntities('progressPace', 'class')[0].value
    expect(getRateComparison('progressPace', 'class', id, 'school', 'week').windowLabel).toBe('Last 7 days')
    expect(getRateComparison('progressPace', 'class', id, 'school', '4w').windowLabel).toBe('Last 30 days')
    expect(getRateComparison('progressPace', 'class', id, 'school', 'term').windowLabel).toBe('Last 30 days')
    expect(() => getRateComparison('progressPace', 'class', id, 'school', 'not-a-window')).not.toThrow()
    const out = getRateComparison('progressPace', 'class', id, 'school', 'not-a-window')
    expect(out.windowLabel).toBe('Last 30 days')
    expect(out.entity.trend).toHaveLength(30)
  })
})
