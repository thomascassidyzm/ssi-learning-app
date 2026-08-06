import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import router, { lastDashboardPath } from '@/router/index'
import AppEscape from './AppEscape.vue'

// Owner ruling 2026-08-06: entering the player always gives the immersive,
// navless player at '/'. That route sets meta.hideAppEscape, so a plain learner
// sees NO chrome — exactly the screen Tom asked for. But staff self-practice now
// lands there too with no shell nav, so App.vue shows the one low-emphasis
// escape pill back to whichever management surface the user came from, keyed on
// the existing `ssi-last-dashboard` breadcrumb.
describe('immersive player escape — the ssi-last-dashboard breadcrumb', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('a plain learner (no breadcrumb) gets no escape — the fully navless player', () => {
    expect(lastDashboardPath()).toBe(null)
  })

  it('a schools user goes back to /schools; a tutor to /tutors/dashboard', () => {
    localStorage.setItem('ssi-last-dashboard', 'schools')
    expect(lastDashboardPath()).toBe('/schools')
    localStorage.setItem('ssi-last-dashboard', 'teach')
    expect(lastDashboardPath()).toBe('/tutors/dashboard')
  })

  it('the immersive player still opts out of the DEFAULT history-back escape', () => {
    const playerRoute = router.getRoutes().find((r) => r.name === 'player')
    expect(playerRoute?.meta?.hideAppEscape).toBe(true)
  })

  it('with `to` set the pill navigates to that surface instead of history-back', async () => {
    const push = vi.spyOn(router, 'push')
    const back = vi.spyOn(router, 'back')
    const wrapper = mount(AppEscape, {
      props: { to: '/schools' },
      global: { plugins: [router] },
    })
    await wrapper.get('button.app-escape').trigger('click')
    expect(push).toHaveBeenCalledWith('/schools')
    expect(back).not.toHaveBeenCalled()
    push.mockRestore()
    back.mockRestore()
  })
})
