/**
 * RateCompare's cohort-size caption (job #979) — the comparison average's
 * own denominator (peers ACTIVE in the selected window) grows with the
 * window, so a wider window can read a lower average than a narrower one
 * even though the maths is correct (Chepstow: 9.3 over 29 classes at 30d,
 * 8.8 over 32 classes all-time). Naming the cohort size under the figure
 * makes that denominator visible instead of reading as a bug.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RateCompare from './RateCompare.vue'
import type { RateComparisonData } from '../spec'

vi.mock('./RateTrend.vue', () => ({
  default: { name: 'RateTrend', props: ['entity', 'average', 'entityLabel', 'averageLabel', 'yLabel', 'periodDays'], template: '<div />' },
}))

function baseData(overrides: Partial<RateComparisonData> = {}): RateComparisonData {
  return {
    metricLabel: 'Rate of progress',
    unit: 'LEGOs',
    per: 'week',
    entity: { label: '10P', value: 12, trend: [1, 2] },
    average: { label: 'Ysgol Cas-gwent Chepstow school average', value: 8.8, trend: [1, 1] },
    deltaPct: 36.4,
    percentile: 80,
    distribution: { values: [4, 8, 9], min: 4, q1: 6, median: 8, q3: 9, max: 9, entityValue: 12, averageValue: 8.8, percentile: 80 },
    ...overrides,
  }
}

describe('RateCompare cohort-size caption', () => {
  it('names the cohort size and unit under the comparison figure', () => {
    const wrapper = mount(RateCompare, {
      props: { data: baseData({ cohortSize: 32, cohortUnit: 'classes' }) },
    })
    expect(wrapper.find('.rc-stat-cohort-size').text())
      .toBe('Ysgol Cas-gwent Chepstow school average · mean of 32 classes active in this window')
  })

  it('omits the cohort-size line when the server has not sent a size + unit', () => {
    const wrapper = mount(RateCompare, { props: { data: baseData() } })
    expect(wrapper.find('.rc-stat-cohort-size').exists()).toBe(false)
  })
})
