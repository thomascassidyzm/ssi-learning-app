/**
 * RateCompare's cohort-size caption (job #979) — the comparison average is
 * now a fixed, self-inclusive mean over EVERY class/school in scope, active
 * or not (Tom's ruling 2026-09-16: "a set member should ALWAYS be included
 * in the average"). Naming the cohort size under the figure ("school
 * average · all 32 classes on this course") makes that denominator visible.
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
    average: { label: 'Ysgol Cas-gwent Chepstow average', value: 8.8, trend: [1, 1] },
    deltaPct: 36.4,
    percentile: 80,
    distribution: { values: [4, 8, 9, 12], min: 4, q1: 6, median: 8, q3: 9, max: 12, entityValue: 12, averageValue: 8.8, percentile: 80 },
    ...overrides,
  }
}

describe('RateCompare cohort-size caption', () => {
  it('prefers the server-formatted cohortSizeLine', () => {
    const wrapper = mount(RateCompare, {
      props: { data: baseData({ cohortSizeLine: 'Ysgol Cas-gwent Chepstow average · all 32 classes on this course' }) },
    })
    expect(wrapper.find('.rc-stat-cohort-size').text())
      .toBe('Ysgol Cas-gwent Chepstow average · all 32 classes on this course')
  })

  it('falls back to assembling the line from cohortSize + cohortUnit', () => {
    const wrapper = mount(RateCompare, {
      props: { data: baseData({ cohortSize: 32, cohortUnit: 'classes' }) },
    })
    expect(wrapper.find('.rc-stat-cohort-size').text())
      .toBe('Ysgol Cas-gwent Chepstow average · all 32 classes')
  })

  it('omits the cohort-size line when the server has sent none of it', () => {
    const wrapper = mount(RateCompare, { props: { data: baseData() } })
    expect(wrapper.find('.rc-stat-cohort-size').exists()).toBe(false)
  })
})
