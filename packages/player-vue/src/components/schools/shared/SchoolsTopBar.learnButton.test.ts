import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Owner ruling 2026-08-06 — this REVERSES the earlier ruling this file used to
// pin (that staff self-practice should keep SchoolsTopBar above the player on
// the embedded `schools-play` route). The same player was reachable as two
// different screens depending on the door you came through: navless via '/',
// wrapped in schools chrome via the Learn button. Converge on the navless one.
//
//   1. The Learn button targets the immersive player '/' — never /schools/play.
//   2. No Learn button while you are already IN the player, on any player route
//      (`player`, `schools-play`, `teach-play`), class session live or not.
//
// /schools/play survives for play-as-class ONLY (the class identity in the bar
// is doing real work there) and now requires a `?class=` query.
describe('SchoolsTopBar — Learn button', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'teacher-1', learner_id: 'l1', display_name: 'Teacher', educational_role: 'teacher', platform_role: null,
    }
    await router.push('/schools')
    await router.isReady()
  })

  it('targets the immersive navless player, not the embedded schools-play route', async () => {
    const wrapper = mount(SchoolsTopBar, {
      global: { plugins: [router], provide: { auth: null } },
    })
    const link = wrapper.get('a.learn-btn')
    expect(link.attributes('href')).toBe('/')
  })

  it('does not render while already in the player (embedded schools-play, class session live)', async () => {
    const cls = { id: 'c1', name: '6S', course_code: 'spa_for_eng' }
    localStorage.setItem('ssi-active-class', JSON.stringify(cls))
    await router.push({ path: '/schools/play', query: { class: cls.id } })
    const wrapper = mount(SchoolsTopBar, {
      global: { plugins: [router], provide: { auth: null } },
    })
    expect(router.currentRoute.value.name).toBe('schools-play')
    expect(wrapper.find('a.learn-btn').exists()).toBe(false)
  })

  it('the immersive player route is NOT a child of /schools — no shell chrome above it', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('player')
    expect(router.currentRoute.value.matched.some((r) => r.path === '/schools')).toBe(false)
  })

  it('play-as-class keeps the embedded route: schools-play stays a child of /schools', async () => {
    await router.push({ path: '/schools/play', query: { class: 'c1' } })
    expect(router.currentRoute.value.name).toBe('schools-play')
    expect(router.currentRoute.value.matched.some((r) => r.path === '/schools')).toBe(true)
  })

  it('a class-less arrival on /schools/play (stale bookmark) is sent to the immersive player', async () => {
    await router.push('/schools/play')
    expect(router.currentRoute.value.name).toBe('player')
  })
})
