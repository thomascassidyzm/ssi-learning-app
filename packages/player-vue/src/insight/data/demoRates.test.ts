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

  it('every hero rate declares unit, per, levels ⊆ the canonical set, and ≥1 average', () => {
    const allowed = new Set(['learner', 'class', 'school', 'course'])
    for (const m of HERO_RATES) {
      expect(m.unit.length).toBeGreaterThan(0)
      expect(m.per.length).toBeGreaterThan(0)
      expect(m.entityLevels.length).toBeGreaterThan(0)
      expect(m.entityLevels.every((l) => allowed.has(l))).toBe(true)
      expect(m.averages.length).toBeGreaterThan(0)
    }
  })

  it('lists 8–14 named entities per (metric, level)', () => {
    const opts = listEntities('progressPace', 'class')
    expect(opts.length).toBeGreaterThanOrEqual(8)
    expect(opts.length).toBeLessThanOrEqual(14)
    expect(opts[0].label.length).toBeGreaterThan(0)
  })

  it('is deterministic — the same selection yields the identical comparison twice', () => {
    const id = listEntities('progressPace', 'class')[2].value
    const a = getRateComparison('progressPace', 'class', id, 'course avg')
    const b = getRateComparison('progressPace', 'class', id, 'course avg')
    expect(a).toEqual(b)
  })

  it('returns a well-formed, internally-coherent comparison', () => {
    const opts = listEntities('progressPace', 'class')
    const out = getRateComparison('progressPace', 'class', opts[0].value, 'course avg')
    expect(out.metricLabel).toBe('Rate of progress')
    expect(out.unit).toBe('LEGOs')
    expect(out.per).toBe('week')
    // entity matches the picked one; 8-period trends on both sides
    expect(out.entity.label).toBe(opts[0].label)
    expect(out.entity.trend).toHaveLength(8)
    expect(out.average.trend).toHaveLength(8)
    // cohort lists ALL entities, sorted by value desc, exactly one flagged isEntity
    expect(out.cohort.length).toBe(opts.length)
    for (let i = 1; i < out.cohort.length; i++) {
      expect(out.cohort[i - 1].value).toBeGreaterThanOrEqual(out.cohort[i].value)
    }
    expect(out.cohort.filter((c) => c.isEntity)).toHaveLength(1)
    // percentile in range; deltaPct sign agrees with entity-vs-average
    expect(out.percentile).toBeGreaterThanOrEqual(0)
    expect(out.percentile).toBeLessThanOrEqual(100)
    const expectUp = out.entity.value >= out.average.value
    expect(out.deltaPct >= 0).toBe(expectUp)
  })

  it('the cohort leader is at-or-above every average cohort and reads as top percentile', () => {
    // leader = first option (population is value-desc)
    const leaderId = listEntities('progressPace', 'class')[0].value
    const out = getRateComparison('progressPace', 'class', leaderId, 'course avg')
    expect(out.entity.value).toBeGreaterThanOrEqual(out.average.value)
    expect(out.percentile).toBe(100)
    expect(out.deltaPct).toBeGreaterThanOrEqual(0)
  })

  it('attaches a position contextLine only for position-bearing metrics', () => {
    const withPos = getRateComparison(
      'progressPace', 'class', listEntities('progressPace', 'class')[0].value, 'course avg',
    )
    expect(withPos.contextLine).toMatch(/Furthest LEGO · S\d+ · L\d{2}/)

    const withoutPos = getRateComparison(
      'appMinutesDay', 'class', listEntities('appMinutesDay', 'class')[0].value, 'course avg',
    )
    expect(withoutPos.contextLine).toBeUndefined()
  })

  it('falls back gracefully on unknown metric / entity / average (never throws)', () => {
    // unknown metric → empty shape
    const bad = getRateComparison('nope', 'class', 'x', 'course avg')
    expect(bad.cohort).toEqual([])
    expect(() => getRateComparison('nope', 'class', 'x', 'course avg')).not.toThrow()

    // unknown entity id → falls back to the leader (first), still coherent
    const out = getRateComparison('progressPace', 'class', 'does-not-exist', 'course avg')
    expect(out.cohort.length).toBeGreaterThan(0)
    expect(out.entity.label).toBe(listEntities('progressPace', 'class')[0].label)

    // unknown average → falls back to the metric's first average
    const avg = getRateComparison(
      'progressPace', 'class', listEntities('progressPace', 'class')[0].value, 'not-an-average',
    )
    expect(listAverages('progressPace')).toContain(avg.average.label)
  })

  it('different averages genuinely differ (peer cohort sits above all-classes avg)', () => {
    const id = listEntities('progressPace', 'class')[3].value
    const peer = getRateComparison('progressPace', 'class', id, 'peer cohort')
    const allClasses = getRateComparison('progressPace', 'class', id, 'all-classes avg')
    expect(peer.average.value).toBeGreaterThan(allClasses.average.value)
  })

  it('listEntityLevels / listAverages mirror the hero-rate definitions', () => {
    expect(listEntityLevels('progressPace')).toEqual(HERO_RATES[0].entityLevels)
    expect(listAverages('progressPace')).toEqual(HERO_RATES[0].averages)
    expect(listEntityLevels('nope')).toEqual([])
    expect(listAverages('nope')).toEqual([])
  })
})
