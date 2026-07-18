import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// THE-MODEL §1.3/I5: a groupless tutor gets the SAME teacher tab set as a
// school-employed teacher, plus a reachable Upgrade tab — nobody else can
// bill them (a school admin manages a school teacher's billing; a tutor has
// no admin). Structure-gated on school_id, never on the 'tutor' label.
describe('SchoolsTopBar — tutor tab set', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    await router.push('/schools')
    await router.isReady()
  })

  it('a school-employed teacher (has school_id) gets no Upgrade tab — their admin bills them', async () => {
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'teacher-1', learner_id: 'l1', display_name: 'Teacher', educational_role: 'teacher',
      platform_role: null, school_id: 's1',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const labels = wrapper.findAll('.tabs a, .tabs router-link').map((l) => l.text())
    expect(labels).toEqual(['Dashboard', 'Students', 'Analytics'])
  })

  it('a groupless tutor (educational_role tutor, no school_id) gets an Upgrade tab', async () => {
    role.initialize(null, 'tutor')
    ;(ctx.currentUser as any).value = {
      user_id: 'tutor-1', learner_id: 'l2', display_name: 'Tutor', educational_role: 'tutor',
      platform_role: null,
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    const labels = links.map((l) => l.text())
    expect(labels).toEqual(['Dashboard', 'Students', 'Analytics', 'Upgrade'])
    const upgrade = links.find((l) => l.text() === 'Upgrade')
    expect(upgrade?.attributes('href')).toBe('/schools/upgrade')
  })

  it('a groupless tutor gets no Classes/Teachers tabs (those belong to the admin bucket, not the derived-teacher shell)', async () => {
    role.initialize(null, 'tutor')
    ;(ctx.currentUser as any).value = {
      user_id: 'tutor-2', learner_id: 'l3', display_name: 'Tutor', educational_role: 'tutor',
      platform_role: null,
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const labels = wrapper.findAll('.tabs a').map((l) => l.text())
    expect(labels).not.toContain('Classes')
    expect(labels).not.toContain('Teachers')
  })
})
