import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Founder ruling (2026-07-18): in play-as-class mode the ONE thing the bar must
// say is WHICH CLASS is live — big, bold, unmissable — with the section tabs and
// self-practice launcher dropped and the school demoted. A teacher running
// back-to-back sessions on a projector/shared device otherwise can't tell 6S
// from 6M.
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

  it('renders the class name prominently and drops the section tabs while a class session is live', async () => {
    localStorage.setItem(
      'ssi-active-class',
      JSON.stringify({ id: 'class-6s', name: '6S', course_code: 'cym_for_eng' }),
    )
    const wrapper = await mountOnPlayRoute('class-6s')

    // The class name renders as the dominant identity element…
    const className = wrapper.get('.pac-class')
    expect(className.text()).toBe('6S')
    // …introduced as "Playing as" and demoting the school to a secondary line.
    expect(wrapper.get('.pac-kicker').text().replace(/\s+/g, ' ')).toContain('Playing as')
    expect(wrapper.get('.pac-school').text()).toBe('Chepstow School')

    // The section tabs and the school "context-name" label are dropped in the mode.
    expect(wrapper.find('nav.tabs').exists()).toBe(false)
    expect(wrapper.find('.context-name').exists()).toBe(false)
    // The self-practice Learn launcher is dropped too.
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
    // Normal chrome restored: tabs + Learn button present.
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
