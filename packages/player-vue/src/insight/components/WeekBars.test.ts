import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WeekBars from './WeekBars.vue'

describe('WeekBars — bars with a faint normal line', () => {
  it('draws one bar per present week with the cohort mean as a single faint line, and no chart furniture', () => {
    const w = mount(WeekBars, { props: { entity: [1, 2, 3], cohort: [2, 2, 2] } })
    expect(w.findAll('.wb-bar')).toHaveLength(3)
    expect(w.findAll('.wb-normal')).toHaveLength(1)
    expect(w.find('text').exists()).toBe(false)
    expect(w.text()).toBe('')
  })

  it('emphasises the current week and fades the weeks behind it', () => {
    const w = mount(WeekBars, { props: { entity: [1, 2, 3] } })
    const bars = w.findAll('.wb-bar')
    expect(bars.map((b) => b.classes().includes('now'))).toEqual([false, false, true])
    const chosen = mount(WeekBars, { props: { entity: [1, 2, 3], currentIndex: 1 } })
    expect(chosen.findAll('.wb-bar').map((b) => b.classes().includes('now'))).toEqual([false, true, false])
  })

  it('absence is absence: no bar at all, and the faint line breaks rather than bridging', () => {
    const w = mount(WeekBars, { props: { entity: [1, null, 3], cohort: [1, null, 3] } })
    expect(w.findAll('.wb-bar')).toHaveLength(2)
    const d = w.find('.wb-normal').attributes('d') ?? ''
    expect((d.match(/M/g) ?? []).length).toBe(2)
  })

  it('a series that never started draws nothing at all', () => {
    const w = mount(WeekBars, { props: { entity: [null, null], cohort: [null] } })
    expect(w.find('svg').exists()).toBe(false)
  })

  it('bars alone when there is no cohort to compare with', () => {
    const w = mount(WeekBars, { props: { entity: [1, 2] } })
    expect(w.findAll('.wb-bar')).toHaveLength(2)
    expect(w.find('.wb-normal').exists()).toBe(false)
  })

  it('compact is shorter than the card size, same drawing', () => {
    const card = mount(WeekBars, { props: { entity: [1, 2] } })
    const compact = mount(WeekBars, { props: { entity: [1, 2], size: 'compact' } })
    const h = (v: string | undefined): number => Number((v ?? '').split(' ')[3])
    expect(h(compact.find('svg').attributes('viewBox'))).toBeLessThan(h(card.find('svg').attributes('viewBox')))
    expect(compact.findAll('.wb-bar')).toHaveLength(2)
  })
})
