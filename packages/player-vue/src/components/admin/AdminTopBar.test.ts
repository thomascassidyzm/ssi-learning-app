import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import AdminTopBar from './AdminTopBar.vue'
import { QUESTIONS, questionPath } from '@/intel/questions'

// THE ONE BAR (2026-09-10, design §3.1 and §3.3; Tom: "share"). The dark
// admin bar died; this white bar carries the ten questions, the two scope
// pickers and the Tools door, on every internal page. These tests pin the
// design's checkable rules: every one of the ten answers is ONE TAP from
// every page of the surface, the org tree and the people list are one tap,
// the chores live behind Tools, and the collapsed trigger names the current
// section so "where am I" survives the collapse.
describe('AdminTopBar — the ten questions, one tap from anywhere', () => {
  async function mountAt(path: string) {
    await router.push(path)
    await router.isReady()
    return mount(AdminTopBar, { global: { plugins: [router] } })
  }

  it('puts all ten questions one tap away, on a question page and on the org tree alike', async () => {
    for (const path of ['/intel/pulse', '/admin/structure', '/admin/users']) {
      const wrapper = await mountAt(path)
      const hrefs = wrapper.findAll('.tabs a.tab').map((a) => a.attributes('href'))
      for (const q of QUESTIONS) {
        expect(hrefs, `question ${q.n} (${q.tab}) must be one tap from ${path}`).toContain(questionPath(q))
      }
    }
  })

  it('groups the questions as Learners, Content and Business, and nothing else', async () => {
    const wrapper = await mountAt('/intel/pulse')
    expect(wrapper.findAll('.group-name').map((el) => el.text())).toEqual(['Learners', 'Content', 'Business'])
  })

  it('marks the question you are on, and only that one', async () => {
    const wrapper = await mountAt('/intel/weak-points')
    const active = wrapper.findAll('.tabs a.tab.active')
    expect(active).toHaveLength(1)
    expect(active[0].text()).toBe('Weak points')
  })

  it('offers the two trees a named thing lives in, one tap each', async () => {
    const wrapper = await mountAt('/intel/pulse')
    const hrefs = wrapper.findAll('.tabs a.tab').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/admin/structure')
    expect(hrefs).toContain('/admin/users')
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

  it('names the current section on the collapsed trigger, and carries everything in that one menu', async () => {
    const wrapper = await mountAt('/admin/users')
    expect(wrapper.find('.tabs-collapsed .nvm-trigger-label').text()).toBe('People')
    await wrapper.find('.tabs-collapsed .nvm-trigger').trigger('click')
    const items = wrapper.findAll('.tabs-collapsed .nvm-item-label').map((el) => el.text())
    for (const q of QUESTIONS) expect(items).toContain(q.tab)
    expect(items).toContain('Organisations')
    expect(items).toContain('People')
    expect(items).toContain('Handbook')
  })
})
