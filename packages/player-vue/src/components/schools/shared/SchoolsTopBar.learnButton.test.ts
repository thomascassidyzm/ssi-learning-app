import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// The owner's ruling (supersedes an earlier breadcrumb/back-button approach):
// staff self-practice via the Learn button should keep SchoolsTopBar visible
// above the player — the SAME embedded-route mechanism "Play as class" already
// uses (route name `schools-play`, rendered as a child of SchoolsContainer so
// its top bar stays put). So the Learn button must point at /schools/play,
// NOT the standalone immersive player route ('/').
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

  it('routes to the embedded schools-play route, not the standalone player', async () => {
    const wrapper = mount(SchoolsTopBar, {
      global: { plugins: [router], provide: { auth: null } },
    })
    const link = wrapper.get('a.learn-btn')
    expect(link.attributes('href')).toBe('/schools/play')
  })

  it('the Learn button target (schools-play) is a child of /schools, so SchoolsContainer + SchoolsTopBar stay mounted above it', async () => {
    await router.push('/schools/play')
    expect(router.currentRoute.value.name).toBe('schools-play')
    expect(router.currentRoute.value.matched.some((r) => r.path === '/schools')).toBe(true)
  })
})
