import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PlanPanel from './PlanPanel.vue'

const STORAGE_KEY = 'ssi-plan-cadence'

function mountPanel(hoursDone = 4, source: 'real' | 'mock' = 'real') {
  return mount(PlanPanel, { props: { plan: { hoursDone, targetHours: 30, source } } })
}

describe('PlanPanel — the reasonable plan (2026-08-03 rulings)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('offers a menu of routes that all add up to the same thirty hours', () => {
    const wrapper = mountPanel()
    const routes = wrapper.findAll('.route')
    expect(routes.length).toBeGreaterThanOrEqual(4)
    const text = wrapper.text()
    expect(text).toContain('6 hours a day, 5 days')
    expect(text).toContain('1 hour a day, 30 days')
  })

  it('persists the chosen route to localStorage and restores it on remount', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.route')[1].trigger('click')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('hour-a-day')

    const remounted = mountPanel()
    await remounted.vm.$nextTick()
    expect(remounted.find('.chosen').exists()).toBe(true)
    expect(remounted.text()).toContain('An hour a day')
  })

  it('collapses the ask to pressing play once a route is chosen', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.route')[0].trigger('click')
    expect(wrapper.text()).toContain('press play')
  })

  it('lets the learner pick again without any language of failure', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.route')[0].trigger('click')
    await wrapper.find('.change').trigger('click')
    expect(wrapper.findAll('.route').length).toBeGreaterThan(0)
  })

  // HARD LAWS — a violation here is a build failure, not a style note.
  it('never speaks of streaks, missed days, deadlines, points or scores', () => {
    const banned = [
      'streak',
      'days since',
      'missed',
      'miss a',
      'deadline',
      'due',
      'left to go',
      'remaining',
      'behind schedule',
      'points',
      'score',
      'xp',
      'leaderboard',
      'rank',
      'lego',
      'cadence',
      'adherence',
      'prosody',
    ]
    const text = mountPanel(0).text().toLowerCase()
    for (const word of banned) expect(text).not.toContain(word)
  })

  it('frames progress as ground already covered, at zero hours and beyond', () => {
    expect(mountPanel(0).text()).toContain('the first go is the whole trick')
    expect(mountPanel(12).text()).toContain('already behind you')
    expect(mountPanel(41).text()).toContain('past thirty hours')
  })

  it('labels sample data plainly', () => {
    expect(mountPanel(4, 'mock').text()).toContain('Sample data — not your real numbers yet.')
    expect(mountPanel(4, 'real').text()).not.toContain('Sample data')
  })
})
