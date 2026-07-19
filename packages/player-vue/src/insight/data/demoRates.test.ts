import { describe, it, expect } from 'vitest'
import {
  HERO_RATES,
  getRateComparison,
  listEntities,
  listAverages,
  listEntityLevels,
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
    expect(out.entity.trend).toHaveLength(8)
    expect(out.average.trend).toHaveLength(8)
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
})
