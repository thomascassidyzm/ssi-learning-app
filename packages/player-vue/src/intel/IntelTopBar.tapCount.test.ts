/**
 * The tap-count test the design asks for: "From the landing page, every one of
 * the ten answers is one tap. A test walks the ten and counts."
 *
 * One tap means one link, present in the bar, on every page of the surface —
 * the bar is mounted by the container above the router view, so if the bar
 * carries all ten then every answer is one tap from every other answer too.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import IntelTopBar from './IntelTopBar.vue'
import { QUESTIONS, questionPath } from './questions'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/intel/pulse' }),
}))

const stubs = {
  'router-link': {
    props: ['to'],
    template: '<a :href="to" :data-to="to"><slot /></a>',
  },
}

describe('the top bar', () => {
  it('puts all ten questions one tap away', () => {
    const w = mount(IntelTopBar, { global: { stubs } })
    const hrefs = w.findAll('a[data-to]').map((a) => a.attributes('data-to'))
    for (const q of QUESTIONS) {
      expect(hrefs, `question ${q.n} (${q.tab}) must be one tap from the bar`).toContain(questionPath(q))
    }
  })

  it('groups them as Learners, Content and Business, and nothing else', () => {
    const w = mount(IntelTopBar, { global: { stubs } })
    const groups = w.findAll('.group-name').map((el) => el.text())
    expect(groups).toEqual(['Learners', 'Content', 'Business'])
  })

  it('marks the question you are on', () => {
    const w = mount(IntelTopBar, { global: { stubs } })
    const active = w.findAll('.tab.active')
    expect(active).toHaveLength(1)
    expect(active[0].text()).toBe('Pulse')
  })
})
