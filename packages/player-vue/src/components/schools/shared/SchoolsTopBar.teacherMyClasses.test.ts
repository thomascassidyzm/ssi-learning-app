import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Founder ruling 2026-09-16: a teacher's My Classes is a top-nav entry. Before
// this it was reachable only sideways, through the 'Classes /' crumb on a class
// page. Later the same day, the second half of that ruling: the dashboard and
// My Classes are ONE page, so the teacher's nav is exactly My Classes,
// Students, Insights and the Dashboard tab is gone.
describe('SchoolsTopBar — teacher My Classes', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  function signInTeacher() {
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'teacher-1', learner_id: 'l1', display_name: 'Teacher', educational_role: 'teacher',
      platform_role: null, school_id: 's1',
    }
  }

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    await router.push('/schools')
    await router.isReady()
  })

  it('leads the nav, with no Dashboard tab beside it, and points at /schools/classes', async () => {
    signInTeacher()
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    expect(links.map((l) => l.text())).toEqual(['My Classes', 'Students', 'Insights'])
    expect(links[0].attributes('href')).toBe('/schools/classes')
  })

  it('is highlighted on the classes list AND on a class page', async () => {
    signInTeacher()
    for (const path of ['/schools/classes', '/schools/classes/abc-123']) {
      await router.push(path)
      const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
      const active = wrapper.findAll('.tabs a.active').map((l) => l.text())
      expect(active, `active tab on ${path}`).toEqual(['My Classes'])
    }
  })
})
