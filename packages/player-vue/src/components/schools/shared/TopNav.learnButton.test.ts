import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import TopNav from './TopNav.vue'

// Owner ruling 2026-08-06 — the tutor-side mirror of the SchoolsTopBar rule:
// the Learn button already targeted the immersive player '/', but it went on
// rendering while the tutor was already inside the embedded player at
// /tutors/dashboard/play. It must not render on any player route.
describe('TopNav — Learn button', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'tutor-1', learner_id: 'l1', display_name: 'Tutor', educational_role: 'teacher', platform_role: null,
    }
    await router.push('/tutors/dashboard')
    await router.isReady()
  })

  function mountNav() {
    return mount(TopNav, {
      props: { mode: 'teach' as const },
      global: { plugins: [router], provide: { auth: null, supabase: { value: null } } },
    })
  }

  it('renders on the dashboard and targets the immersive player', async () => {
    const push = vi.spyOn(router, 'push')
    const wrapper = mountNav()
    expect(wrapper.find('button.learn-btn').exists()).toBe(true)
    await wrapper.get('button.learn-btn').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/')
    push.mockRestore()
  })

  it('does not render while already in the player (embedded teach-play, class session live)', async () => {
    localStorage.setItem(
      'ssi-active-class',
      JSON.stringify({ id: 'c1', name: 'Y7', course_code: 'cym_for_eng' }),
    )
    await router.push({ path: '/tutors/dashboard/play', query: { class: 'c1' } })
    const wrapper = mountNav()
    expect(router.currentRoute.value.name).toBe('teach-play')
    expect(wrapper.find('button.learn-btn').exists()).toBe(false)
    // The mobile menu's "My Learning" item is the same affordance — it goes too.
    expect(wrapper.find('a.mobile-menu-learn').exists()).toBe(false)
  })

  it('a class-less arrival on /tutors/dashboard/play is sent to the immersive player', async () => {
    await router.push('/tutors/dashboard/play')
    expect(router.currentRoute.value.name).toBe('player')
  })
})
