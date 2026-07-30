import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Founder rulings, layered:
// - 2026-07-18: in play-as-class mode the bar must say WHICH CLASS is live —
//   a teacher running back-to-back sessions on a projector/shared device
//   otherwise can't tell 6S from 6M.
// - 2026-07-30: "once a schools dashboard user - every user facing screen
//   should keep the schools dashboard top nav." The class identity is now a
//   SLIM chip inside the bar and the section tabs STAY during a session (the
//   old mode dropped them, which read as the player taking over). Only the
//   self-practice Learn launcher is dropped; the standalone school label
//   yields to the chip, which carries the school itself.
describe('SchoolsTopBar — play-as-class identity', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'teacher-1',
      learner_id: 'l1',
      display_name: 'Teacher',
      educational_role: 'teacher',
      platform_role: null,
      school_name: 'Chepstow School',
    }
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  async function mountOnPlayRoute(classId: string) {
    await router.push({ path: '/schools/play', query: { class: classId } })
    await router.isReady()
    return mount(SchoolsTopBar, {
      global: { plugins: [router], provide: { auth: null } },
    })
  }

  it('renders the class name in the slim chip and KEEPS the section tabs while a class session is live', async () => {
    localStorage.setItem(
      'ssi-active-class',
      JSON.stringify({ id: 'class-6s', name: '6S', course_code: 'cym_for_eng' }),
    )
    const wrapper = await mountOnPlayRoute('class-6s')

    // The class name renders in the playing-as chip…
    const className = wrapper.get('.pac-class')
    expect(className.text()).toBe('6S')
    // …introduced as "Playing as", with the school demoted inside the chip.
    expect(wrapper.get('.pac-kicker').text().replace(/\s+/g, ' ')).toContain('Playing as')
    expect(wrapper.get('.pac-school').text()).toBe('Chepstow School')

    // The section tabs STAY — the schools nav persists inside the player
    // (founder ruling, 2026-07-30). The standalone school label yields to
    // the chip (which carries the school itself).
    expect(wrapper.find('nav.tabs').exists()).toBe(true)
    expect(wrapper.findAll('nav.tabs a').length).toBeGreaterThan(0)
    expect(wrapper.find('.context-name').exists()).toBe(false)
    // The self-practice Learn launcher is the one thing dropped mid-session.
    expect(wrapper.find('a.learn-btn').exists()).toBe(false)

    // Exit affordance stays obvious.
    expect(wrapper.find('.pac-exit').exists()).toBe(true)
  })

  it('does NOT show the play-as-class identity for staff self-practice (same route, no ?class=)', async () => {
    // A stale payload can linger from a previous session; without a matching
    // ?class= query it must NOT be treated as a live class session.
    localStorage.setItem(
      'ssi-active-class',
      JSON.stringify({ id: 'class-6s', name: '6S', course_code: 'cym_for_eng' }),
    )
    await router.push('/schools/play')
    await router.isReady()
    const wrapper = mount(SchoolsTopBar, {
      global: { plugins: [router], provide: { auth: null } },
    })

    expect(wrapper.find('.pac-class').exists()).toBe(false)
    // Normal chrome: tabs + Learn button present.
    expect(wrapper.find('nav.tabs').exists()).toBe(true)
    expect(wrapper.find('a.learn-btn').exists()).toBe(true)
  })

  it('does NOT show the identity when the stored class id does not match ?class=', async () => {
    localStorage.setItem(
      'ssi-active-class',
      JSON.stringify({ id: 'class-6m', name: '6M', course_code: 'cym_for_eng' }),
    )
    const wrapper = await mountOnPlayRoute('class-6s')
    expect(wrapper.find('.pac-class').exists()).toBe(false)
  })
})
