import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

// Nav unification (2026-07-29): THE VIEW is the one frame for hierarchy
// leaders. A group-scoped govt_admin's tabs point at the node surface (node
// home with the schools lens + node insights) — never the retired flat
// All-schools list or the teacher-scoped Analytics tool, which showed a
// confidently-wrong 'No classes yet' to a leader with 23 practising classes
// (founder-found on prod). Legacy no-group rows keep the flat views.
describe('SchoolsTopBar — govt_admin tab set', () => {
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

  it('a group-scoped govt_admin gets node-surface tabs (Schools → node home schools lens, Insights → node insights)', async () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin',
      platform_role: null, group_id: 'grp-wales',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    const labels = links.map((l) => l.text())
    expect(labels).toEqual(['Schools', 'Insights'])
    expect(links[0].attributes('href')).toBe('/org/grp-wales?lens=schools')
    expect(links[1].attributes('href')).toBe('/org/grp-wales/insights')
  })

  it('a group-scoped govt_admin has NO door to the retired flat views', async () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin',
      platform_role: null, group_id: 'grp-wales',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const hrefs = wrapper.findAll('.tabs a').map((l) => l.attributes('href'))
    expect(hrefs).not.toContain('/schools/all')
    expect(hrefs).not.toContain('/schools/analytics')
  })

  it('a legacy no-group govt_admin (region_code-only row) keeps the flat views — the node redirect cannot scope them', async () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-legacy', learner_id: 'l2', display_name: 'Legacy Leader', educational_role: 'govt_admin',
      platform_role: null, region_code: 'XX',
    }
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const links = wrapper.findAll('.tabs a')
    expect(links.map((l) => l.text())).toEqual(['Schools', 'Analytics'])
    expect(links[0].attributes('href')).toBe('/schools/all')
    expect(links[1].attributes('href')).toBe('/schools/analytics')
  })

  it('the Schools tab is active only under the schools lens (plain node home lights no tab)', async () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin',
      platform_role: null, group_id: 'grp-wales',
    }
    await router.push('/org/grp-wales?lens=schools')
    const wrapper = mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null } } })
    const active = wrapper.findAll('.tabs a.active').map((l) => l.text())
    expect(active).toEqual(['Schools'])

    await router.push('/org/grp-wales')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.tabs a.active')).toHaveLength(0)
  })
})
