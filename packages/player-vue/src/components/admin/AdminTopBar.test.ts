import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import AdminTopBar from './AdminTopBar.vue'

// 2026-07-17 navbar redesign, revised 2026-07-18 (THE-MODEL.md §1.10 — "the
// invites page dies"): the bar carries the everyday ideas flat — Structure
// (the org tree, now also the ways-in surface) · Users (people) ·
// Stats + Insights (numbers) — and a grouped "More" menu carries the rest
// with icons + one-line descriptions, including a demoted read-only Invites
// audit list (ways in now live ON the node in Structure, not a nav tab).
// 2026-08-19: Onboarding left this menu — the onboarding message editor
// retired, its copy moved to popty.app/copy/onboarding (one copy surface per
// protocol).
// These tests pin the grouping — every admin destination must stay
// reachable within two clicks, and the More trigger must carry the active
// state when the current section lives inside it (so "where am I" survives
// the collapse).
describe('AdminTopBar — primary tabs + grouped More menu', () => {
  async function mountAt(path: string) {
    await router.push(path)
    await router.isReady()
    const wrapper = mount(AdminTopBar, { global: { plugins: [router] } })
    return wrapper
  }

  it('shows the everyday ideas as flat tabs — Invites demoted, not one of them', async () => {
    const wrapper = await mountAt('/admin/structure')
    const tabLabels = wrapper.findAll('.tabs > a.tab').map((a) => a.text())
    expect(tabLabels).toEqual(['Structure', 'Users', 'Stats', 'Insights'])
  })

  it('the More menu contains every collapsed destination, grouped, incl. the demoted Invites audit list', async () => {
    const wrapper = await mountAt('/admin/structure')
    const more = wrapper.findAll('.tabs .nvm')[0]
    await more.find('button.nvm-trigger').trigger('click')
    const itemLabels = more.findAll('.nvm-item-label').map((el) => el.text())
    expect(itemLabels).toEqual(['Invites (audit)', 'Methodology'])
    const groupLabels = more.findAll('.nvm-group-label').map((el) => el.text())
    expect(groupLabels).toEqual(['Provisioning', 'Platform'])
    // Meaning restored: every collapsed item carries a one-line description.
    expect(more.findAll('.nvm-item-desc')).toHaveLength(2)
  })

  it('marks the More trigger active when the current section lives inside it', async () => {
    const wrapper = await mountAt('/admin/methodology')
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
    expect(items).toEqual(['Structure', 'Users', 'Stats', 'Insights', 'Invites (audit)', 'Methodology'])
  })
})
