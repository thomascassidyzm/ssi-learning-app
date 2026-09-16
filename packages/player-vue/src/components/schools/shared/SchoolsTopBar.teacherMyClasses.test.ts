import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Founder ruling 2026-09-16: a teacher's My Classes is a top-nav entry, sitting
// between Dashboard and Students. Before this it was reachable only sideways,
// through the 'Classes /' crumb on a class page.
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

  it('sits between Dashboard and Students and points at /schools/classes', async () => {
    signInTeacher()
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    expect(links.map((l) => l.text())).toEqual(['Dashboard', 'My Classes', 'Students', 'Insights'])
    expect(links[1].attributes('href')).toBe('/schools/classes')
  })

  it('is highlighted on the classes list AND on a class page', async () => {
    signInTeacher()
    // The class page is /org/:id since job #999; /schools/classes/:id
    // redirects there, so the tab has to light on the destination.
    for (const path of ['/schools/classes', '/org/abc-123']) {
      await router.push(path)
      const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
      const active = wrapper.findAll('.tabs a.active').map((l) => l.text())
      expect(active, `active tab on ${path}`).toEqual(['My Classes'])
    }
  })
})
