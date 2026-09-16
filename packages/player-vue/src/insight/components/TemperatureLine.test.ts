import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TemperatureLine from './TemperatureLine.vue'

describe('TemperatureLine — a thin line, nothing else', () => {
  it('draws the class over a fainter cohort line, with no axes, legend or numbers', () => {
    const w = mount(TemperatureLine, { props: { entity: [1, 2, 3], cohort: [2, 2, 2] } })
    expect(w.findAll('.tl-entity')).toHaveLength(1)
    expect(w.findAll('.tl-cohort')).toHaveLength(1)
    expect(w.find('text').exists()).toBe(false)
    expect(w.text()).toBe('')
  })
  it('breaks the line at absence rather than drawing a zero', () => {
    const w = mount(TemperatureLine, { props: { entity: [1, 2, null, 4, 5] } })
    expect(w.findAll('.tl-entity')).toHaveLength(2)
  })
  it('a series that never started draws nothing at all', () => {
    const w = mount(TemperatureLine, { props: { entity: [null, null], cohort: [null] } })
    expect(w.find('svg').exists()).toBe(false)
  })
})
