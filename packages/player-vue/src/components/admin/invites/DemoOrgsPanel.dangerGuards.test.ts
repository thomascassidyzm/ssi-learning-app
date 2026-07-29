import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Guard for demo-org Purge — the most destructive verb on the admin surface
// (docs/admin-danger-verbs.md #6): the native confirm() is replaced by the
// impact-preview ConfirmDeleteModal, escalating to type-the-name when the
// tree has real recorded activity.

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'tok-1' }),
}))

async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

const expiredOrg = {
  id: 'org-1',
  created_at: '2026-07-01T00:00:00.000Z',
  created_by: 'admin-1',
  prospect_name: 'Ysgol Demo',
  course_code: 'cym_for_eng',
  group_id: 'group-9',
  expires_at: '2026-07-10T00:00:00.000Z',
  status: 'expired',
  expired_at: '2026-07-10T00:00:00.000Z',
  metadata: { orgName: 'Ysgol Demo' },
}

describe('DemoOrgsPanel — purge guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let impact: Record<string, unknown>

  beforeEach(() => {
    impact = { sessionCount: 12, learnerCount: 4, teacherCount: 0, hasRealActivity: true }
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/admin/demo-schools') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true }) } as any
      }
      if (u.includes('/api/admin/demo-schools')) {
        return { ok: true, json: async () => ({ orgs: [expiredOrg] }) } as any
      }
      if (u.includes('/api/groups/group-9')) {
        return { ok: true, json: async () => ({ impact }) } as any
      }
      // tree-groups list and anything else
      return { ok: true, json: async () => ({ groups: [] }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function purgeCalls() {
    return fetchMock.mock.calls.filter(([url, init]) =>
      String(url).includes('/api/admin/demo-schools') &&
      (init as RequestInit | undefined)?.method === 'POST' &&
      JSON.parse(String((init as RequestInit).body)).action === 'purge')
  }

  async function mountPanel() {
    const { default: DemoOrgsPanel } = await import('./DemoOrgsPanel.vue')
    const wrapper = mount(DemoOrgsPanel, {
      global: { stubs: { Teleport: true, GroupTreeNode: true } },
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    // Expired orgs are hidden by default.
    await wrapper.find('.show-expired-toggle input').setValue(true)
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('Purge opens the impact modal with real counts and typed confirm — no native confirm, no write', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)

    const wrapper = await mountPanel()
    const purgeBtn = wrapper.findAll('button').find(b => b.text() === 'Purge')
    expect(purgeBtn).toBeTruthy()
    await purgeBtn!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(purgeCalls()).toHaveLength(0)

    const modal = wrapper.find('[role="alertdialog"]')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('Purge demo org')
    expect(modal.text()).toContain('Ysgol Demo')
    expect(modal.text()).toContain('12 session(s) recorded')
    expect(modal.text()).toContain('4 learner(s)')
    // Real activity → escalates to type-the-name; danger button disabled until typed.
    const input = modal.find('#confirmName')
    expect(input.exists()).toBe(true)
    const dangerBtn = modal.findAll('button').find(b => b.text().includes('Purge'))
    expect(dangerBtn!.attributes('disabled')).toBeDefined()
  })

  it('typing the name enables Purge, which posts the purge action', async () => {
    const wrapper = await mountPanel()
    await wrapper.findAll('button').find(b => b.text() === 'Purge')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const modal = wrapper.find('[role="alertdialog"]')
    await modal.find('#confirmName').setValue('Ysgol Demo')
    await wrapper.vm.$nextTick()

    const dangerBtn = modal.findAll('button').find(b => b.text().includes('Purge'))
    expect(dangerBtn!.attributes('disabled')).toBeUndefined()
    await dangerBtn!.trigger('click')
    await flushPromises()

    expect(purgeCalls()).toHaveLength(1)
    expect(JSON.parse(purgeCalls()[0][1].body)).toEqual({ action: 'purge', id: 'org-1' })
  })

  it('no real activity → modal still gates, but without typed confirm', async () => {
    impact.hasRealActivity = false
    const wrapper = await mountPanel()
    await wrapper.findAll('button').find(b => b.text() === 'Purge')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const modal = wrapper.find('[role="alertdialog"]')
    expect(modal.exists()).toBe(true)
    expect(modal.find('#confirmName').exists()).toBe(false)
    const dangerBtn = modal.findAll('button').find(b => b.text().includes('Purge'))
    expect(dangerBtn!.attributes('disabled')).toBeUndefined()
  })
})
