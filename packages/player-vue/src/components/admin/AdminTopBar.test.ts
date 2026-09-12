import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import AdminTopBar from './AdminTopBar.vue'
import { QUESTIONS, QUESTION_GROUPS, questionPath } from '@/intel/questions'

// TWO MODES, ONE SWITCH (job #340; Tom 2026-09-12 11:57Z: "Yes to admin
// nav"). The bar used to carry three small-caps question groups, a divider and
// an unlabelled schools-admin group, so "Organisations" meant two things and
// the row wrapped at laptop width. Now the route decides the mode:
// /intel/* is Intelligence — the ten questions, one row, grouped by scope to
// match the ScopeRail (Everyone / One person / One organisation); /admin/* is
// Admin — Structure, People, Tools. View-as and Refresh sit in the bar in both.
// These tests pin those rules, plus the one that survived: every one of the
// ten answers is ONE TAP from every /intel page, and the collapsed trigger
// names the current section.
describe('AdminTopBar — Intelligence | Admin, one switch, derived from the route', () => {
  async function mountAt(path: string) {
    await router.push(path)
    await router.isReady()
    return mount(AdminTopBar, { global: { plugins: [router] } })
  }
  const wideHrefs = (w: ReturnType<typeof mount>) => w.findAll('.tabs a.tab').map((a) => a.attributes('href'))
  const switchState = (w: ReturnType<typeof mount>) =>
    w.findAll('.mode-switch a').map((a) => `${a.text()}${a.classes().includes('active') ? '*' : ''}`)

  it('shows the mode the route implies, and the switch lands on each mode\'s front door', async () => {
    let wrapper = await mountAt('/intel/pulse')
    expect(switchState(wrapper)).toEqual(['Intelligence*', 'Admin'])
    wrapper = await mountAt('/admin/structure')
    expect(switchState(wrapper)).toEqual(['Intelligence', 'Admin*'])
    const hrefs = wrapper.findAll('.mode-switch a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['/intel/pulse', '/admin/structure'])
  })

  it('puts all ten questions one tap away from every question page, and nothing from Admin on that row', async () => {
    for (const q of QUESTIONS) {
      const wrapper = await mountAt(questionPath(q))
      const hrefs = wideHrefs(wrapper)
      for (const other of QUESTIONS) {
        expect(hrefs, `question ${other.n} (${other.tab}) must be one tap from ${questionPath(q)}`).toContain(questionPath(other))
      }
      expect(hrefs).not.toContain('/admin/structure')
      expect(hrefs).not.toContain('/admin/users')
      expect(wrapper.findAll('.tabs .nvm')).toHaveLength(0)
    }
  })

  it('groups the questions by scope, in the ScopeRail\'s order, and never by Learners, Content or Business', async () => {
    expect(QUESTION_GROUPS).toEqual(['Everyone', 'One person', 'One organisation'])
    const wrapper = await mountAt('/intel/pulse')
    const groups = wrapper.findAll('.tabs .tab-group')
    expect(groups.map((g) => g.attributes('aria-label'))).toEqual(['Everyone', 'One person', 'One organisation'])
    expect(groups[0].findAll('a.tab').map((a) => a.text())).toEqual([
      'Pulse', 'Leaving', 'Courses', 'Weak points', 'Paying', 'Losing people', 'Working now', 'Where and what',
    ])
    expect(groups[1].findAll('a.tab').map((a) => a.text())).toEqual(['One person'])
    expect(groups[2].findAll('a.tab').map((a) => a.text())).toEqual(['One organisation'])
    expect(wrapper.findAll('.group-name')).toHaveLength(0)
    for (const path of ['/intel/pulse', '/admin/structure']) {
      const text = (await mountAt(path)).text()
      for (const word of ['Learners', 'Content', 'Business']) expect(text).not.toContain(word)
    }
  })

  it('marks the question you are on, and only that one', async () => {
    const wrapper = await mountAt('/intel/weak-points')
    const active = wrapper.findAll('.tabs a.tab.active')
    expect(active).toHaveLength(1)
    expect(active[0].text()).toBe('Weak points')
  })

  it('calls question 10 "One organisation" on its tab and keeps its path', async () => {
    const wrapper = await mountAt('/intel/organisations')
    const active = wrapper.findAll('.tabs a.tab.active')
    expect(active).toHaveLength(1)
    expect(active[0].text()).toBe('One organisation')
    expect(active[0].attributes('href')).toBe('/intel/organisations')
  })

  it('in Admin, offers Structure and People and the Tools door, and no question tabs on the row', async () => {
    for (const path of ['/admin/structure', '/admin/users', '/admin/invites', `/admin/schools/abc`]) {
      const wrapper = await mountAt(path)
      const labels = wrapper.findAll('.tabs a.tab').map((a) => a.text())
      expect(labels, path).toEqual(['Structure', 'People'])
      expect(wideHrefs(wrapper)).toEqual(['/admin/structure', '/admin/users'])
      expect(wrapper.text()).not.toContain('Organisations')
      for (const q of QUESTIONS) expect(wideHrefs(wrapper)).not.toContain(questionPath(q))
    }
    const wrapper = await mountAt('/admin/schools/abc')
    expect(wrapper.findAll('.tabs a.tab.active').map((a) => a.text())).toEqual(['Structure'])
  })

  it('keeps the chores behind the Tools door, each with a one-line meaning', async () => {
    const wrapper = await mountAt('/admin/structure')
    const tools = wrapper.findAll('.tabs .nvm')[0]
    await tools.find('button.nvm-trigger').trigger('click')
    const labels = tools.findAll('.nvm-item-label').map((el) => el.text())
    expect(labels).toEqual(['Release notes', 'Invites audit', 'Methodology', 'Handbook'])
    expect(tools.findAll('.nvm-item-desc')).toHaveLength(4)
  })

  it('marks the Tools trigger active when the current page lives inside it', async () => {
    const wrapper = await mountAt('/admin/methodology')
    expect(wrapper.findAll('.tabs .nvm-trigger')[0].classes()).toContain('is-active')
    expect(wrapper.findAll('.tabs a.tab.active')).toHaveLength(0)
  })

  it('keeps View-as and Refresh in the bar in both modes', async () => {
    for (const path of ['/intel/pulse', '/admin/structure']) {
      const wrapper = await mountAt(path)
      expect(wrapper.findComponent({ name: 'ViewAsPicker' }).exists(), path).toBe(true)
      expect(wrapper.findComponent({ name: 'RefreshButton' }).exists(), path).toBe(true)
    }
  })

  it('names the current section on the collapsed trigger, and carries only the current mode in that one menu', async () => {
    let wrapper = await mountAt('/admin/users')
    expect(wrapper.find('.tabs-collapsed .nvm-trigger-label').text()).toBe('People')
    await wrapper.find('.tabs-collapsed .nvm-trigger').trigger('click')
    let items = wrapper.findAll('.tabs-collapsed .nvm-item-label').map((el) => el.text())
    expect(items).toEqual(['Structure', 'People', 'Release notes', 'Invites audit', 'Methodology', 'Handbook'])
    expect(switchState(wrapper)).toEqual(['Intelligence', 'Admin*'])

    wrapper = await mountAt('/intel/person')
    expect(wrapper.find('.tabs-collapsed .nvm-trigger-label').text()).toBe('One person')
    await wrapper.find('.tabs-collapsed .nvm-trigger').trigger('click')
    items = wrapper.findAll('.tabs-collapsed .nvm-item-label').map((el) => el.text())
    expect(items).toEqual(QUESTIONS.map((q) => q.tab))
    expect(wrapper.findAll('.tabs-collapsed .nvm-group-label').map((el) => el.text())).toEqual(['Everyone', 'One person', 'One organisation'])
    expect(switchState(wrapper)).toEqual(['Intelligence*', 'Admin'])
  })
})
