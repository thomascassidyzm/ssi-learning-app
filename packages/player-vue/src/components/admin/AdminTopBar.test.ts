import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import AdminTopBar from './AdminTopBar.vue'

// 2026-07-17 navbar redesign: nine flat tabs became four everyday tabs
// (Setup / Users / Stats / Insights) + a grouped "More" menu carrying the
// rest with icons + one-line descriptions. These tests pin the grouping —
// every admin destination must stay reachable within two clicks, and the
// More trigger must carry the active state when the current section lives
// inside it (so "where am I" survives the collapse).
//
// Same-day Invites unification: Demos, Try Links and Access folded into
// one /admin/invites entry (docs/invites-redesign/DESIGN.md) — the More
// menu now carries four items across two groups, not five.
describe('AdminTopBar — primary tabs + grouped More menu', () => {
  async function mountAt(path: string) {
    await router.push(path)
    await router.isReady()
    const wrapper = mount(AdminTopBar, { global: { plugins: [router] } })
    return wrapper
  }

  it('shows the everyday four as flat tabs, not all nine', async () => {
    const wrapper = await mountAt('/admin/setup')
    const tabLabels = wrapper.findAll('.tabs > a.tab').map((a) => a.text())
    expect(tabLabels).toEqual(['Setup', 'Users', 'Stats', 'Insights'])
  })

  it('the More menu contains every collapsed destination, grouped', async () => {
    const wrapper = await mountAt('/admin/setup')
    const more = wrapper.findAll('.tabs .nvm')[0]
    await more.find('button.nvm-trigger').trigger('click')
    const itemLabels = more.findAll('.nvm-item-label').map((el) => el.text())
    expect(itemLabels).toEqual(['Onboarding', 'Invites', 'Methodology'])
    const groupLabels = more.findAll('.nvm-group-label').map((el) => el.text())
    expect(groupLabels).toEqual(['Provisioning', 'Platform'])
    // Meaning restored: every collapsed item carries a one-line description.
    expect(more.findAll('.nvm-item-desc')).toHaveLength(3)
  })

  it('marks the More trigger active when the current section lives inside it', async () => {
    const wrapper = await mountAt('/admin/invites')
    const trigger = wrapper.findAll('.tabs .nvm-trigger')[0]
    expect(trigger.classes()).toContain('is-active')
    // ...and no flat tab claims active.
    expect(wrapper.findAll('.tabs > a.tab.active')).toHaveLength(0)
  })

  it('collapsed menu trigger names the CURRENT section, so identity survives the collapse', async () => {
    const wrapper = await mountAt('/admin/users')
    const collapsedTrigger = wrapper.find('.tabs-collapsed .nvm-trigger-label')
    expect(collapsedTrigger.text()).toBe('Users')
    // The collapsed menu carries ALL destinations.
    await wrapper.find('.tabs-collapsed .nvm-trigger').trigger('click')
    const items = wrapper.findAll('.tabs-collapsed .nvm-item-label').map((el) => el.text())
    expect(items).toEqual(['Setup', 'Users', 'Stats', 'Insights', 'Onboarding', 'Invites', 'Methodology'])
  })
})
