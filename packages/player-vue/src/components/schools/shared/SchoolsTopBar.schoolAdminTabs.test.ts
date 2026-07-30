import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Nav unification, third persona (founder ruling 2026-07-30: "it's better to
// have consistency - they should also have the hierarchical LHS WHERE YOU ARE
// menu"): a school-scoped school_admin's Dashboard IS their school's node
// home and Insights the node insights — the same door govt_admin went
// through (2026-07-29). Classes and Students stay flat (Play-as-Class and
// student management have no node-surface equivalent yet); Teachers is
// retired (teachers ARE the node's children, invites live on its verb bar);
// Upgrade stays — school admins own the upgrade job. Legacy no-school rows
// keep the flat set.
describe('SchoolsTopBar — school_admin tab set', () => {
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

  it('a school-scoped school_admin gets node-surface Dashboard + Insights, flat Classes/Students, and Upgrade', async () => {
    role.initialize(null, 'school_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'admin-1', learner_id: 'l1', display_name: 'Chennai Lead', educational_role: 'school_admin',
      platform_role: null, school_id: 'sch-seaside', school_name: 'Seaside Model School',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    const labels = links.map((l) => l.text())
    expect(labels).toEqual(['Dashboard', 'Classes', 'Students', 'Insights', 'Upgrade'])
    expect(links[0].attributes('href')).toBe('/schools/org/sch-seaside')
    expect(links[3].attributes('href')).toBe('/schools/org/sch-seaside/insights')
    expect(links[4].attributes('href')).toBe('/schools/upgrade')
  })

  it('a school-scoped school_admin has NO door to the retired flat Dashboard/Teachers/Analytics', async () => {
    role.initialize(null, 'school_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'admin-1', learner_id: 'l1', display_name: 'Chennai Lead', educational_role: 'school_admin',
      platform_role: null, school_id: 'sch-seaside',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const hrefs = wrapper.findAll('.tabs a').map((l) => l.attributes('href'))
    expect(hrefs).not.toContain('/schools')
    expect(hrefs).not.toContain('/schools/teachers')
    expect(hrefs).not.toContain('/schools/analytics')
  })

  it('a legacy school_admin with no resolvable school keeps the flat set', async () => {
    role.initialize(null, 'school_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'admin-legacy', learner_id: 'l2', display_name: 'Legacy Admin', educational_role: 'school_admin',
      platform_role: null,
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const labels = wrapper.findAll('.tabs a').map((l) => l.text())
    expect(labels).toEqual(['Dashboard', 'Classes', 'Students', 'Teachers', 'Insights', 'Upgrade'])
  })

  it('the Dashboard tab is active on the node home (their landing after the redirect)', async () => {
    role.initialize(null, 'school_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'admin-1', learner_id: 'l1', display_name: 'Chennai Lead', educational_role: 'school_admin',
      platform_role: null, school_id: 'sch-seaside',
    }
    await router.push('/schools/org/sch-seaside')
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const active = wrapper.findAll('.tabs a.active').map((l) => l.text())
    expect(active).toEqual(['Dashboard'])
  })

  it('a teacher tab set is unchanged (Dashboard/Students/Insights, flat)', async () => {
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'teach-1', learner_id: 'l3', display_name: 'Teacher', educational_role: 'teacher',
      platform_role: null, school_id: 'sch-seaside',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    expect(links.map((l) => l.text())).toEqual(['Dashboard', 'Students', 'Insights'])
    expect(links[0].attributes('href')).toBe('/schools')
    expect(links[2].attributes('href')).toBe('/schools/analytics')
  })
})
