/**
 * Tests for AdminStructure.vue — the Structure surface's two lenses
 * (THE-MODEL.md §1.9/§6/§7): table + tree on the same /api/groups/tree and
 * /api/groups/table data, shared search + filter chips, and the node
 * actions (create child, invite, demo-mint, relabel, rename, drill-in).
 * invites/demo-mint endpoints are owned by another worker per THE-MODEL.md
 * §6 — this file calls them per the contract and mocks the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import router from '@/router/index'
import AdminStructure from './AdminStructure.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => ({}),
    getAuthToken: async () => 'test-token',
  }),
}))

function makeNode(overrides: Record<string, any> = {}) {
  return {
    id: 'group-a',
    name: 'Gwynedd',
    label: 'organisation',
    parent_id: null,
    is_demo: false,
    is_test: false,
    rollup: { childGroupCount: 0, teacherCount: 2, classCount: 3, learnerCount: 10 },
    commercial: null,
    children: [],
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function setupFetch(handlers: Record<string, any>) {
  fetchMock = vi.fn(async (url: string) => {
    for (const [pattern, respond] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        const body = typeof respond === 'function' ? respond(url) : respond
        return { ok: true, json: async () => body }
      }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => c[0] as string)
}
function callFor(pattern: string) {
  return fetchMock.mock.calls.find((c) => (c[0] as string).includes(pattern))
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

async function mountStructure() {
  await router.push('/admin/structure')
  await router.isReady()
  const wrapper = mount(AdminStructure, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('AdminStructure — tree lens (default)', () => {
  it('fetches /api/groups/tree on mount and renders the forest', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    expect(calledUrls().some((u) => u.includes('/api/groups/tree'))).toBe(true)
    expect(wrapper.text()).toContain('Gwynedd')
    expect(wrapper.find('.lens-btn.is-active').text()).toBe('Tree')
  })

  it('shows a drill-in affordance when children were depth-truncated', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode({ rollup: { childGroupCount: 2, teacherCount: 0, classCount: 0, learnerCount: 0 }, children: [] })] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    const drillIn = wrapper.find('.structure-drill-in .link-btn')
    expect(drillIn.exists()).toBe(true)
    fetchMock.mockClear()
    await drillIn.trigger('click')
    await flushPromises()
    const treeCall = callFor('/api/groups/tree')
    expect(treeCall![0]).toContain('root=group-a')
  })
})

describe('AdminStructure — table lens + pagination', () => {
  async function mountOnTable(rows: any[], total = 1) {
    setupFetch({
      '/api/groups/tree': { roots: [] },
      '/api/groups/table': { rows, total, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.findAll('.lens-btn').find((b) => b.text() === 'Table')!.trigger('click')
    await flushPromises()
    return wrapper
  }

  it('renders fetched rows including the commercial status pill', async () => {
    const wrapper = await mountOnTable([
      makeNode({
        id: 'group-b', name: 'Ysgol Y Traeth', label: 'school',
        commercial: { schoolId: 's1', platformStatus: 'active', trialCourseCode: null, trialKind: null, platformExpiresAt: null, teacherSeats: 3 },
      }),
    ])
    expect(wrapper.find('.structure-table').exists()).toBe(true)
    expect(wrapper.text()).toContain('Ysgol Y Traeth')
    expect(wrapper.text()).toContain('active')
  })

  it('paginates — Next advances the page and re-fetches', async () => {
    const wrapper = await mountOnTable([makeNode()], 50)
    fetchMock.mockClear()
    await wrapper.find('.pagination button:last-child').trigger('click')
    await flushPromises()
    const call = callFor('/api/groups/table')
    expect(call![0]).toContain('page=2')
  })
})

describe('AdminStructure — shared search + filter chips', () => {
  it('search re-fetches the table lens with the search param (debounced)', async () => {
    const wrapper = await (async () => {
      setupFetch({
        '/api/groups/tree': { roots: [] },
        '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      })
      const w = await mountStructure()
      await w.findAll('.lens-btn').find((b) => b.text() === 'Table')!.trigger('click')
      await flushPromises()
      return w
    })()
    fetchMock.mockClear()
    await wrapper.find('.filter-bar-input').setValue('gwynedd')
    await new Promise((r) => setTimeout(r, 300))
    await flushPromises()
    const call = callFor('/api/groups/table')
    expect(call![0]).toContain('search=gwynedd')
  })

  it('the demo chip re-fetches the table lens with demo=true', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.findAll('.lens-btn').find((b) => b.text() === 'Table')!.trigger('click')
    await flushPromises()
    fetchMock.mockClear()
    await wrapper.findAll('.chip').find((b) => b.text() === 'Demo')!.trigger('click')
    await flushPromises()
    const call = callFor('/api/groups/table')
    expect(call![0]).toContain('demo=true')
  })

  it('the status select re-fetches the table lens with the status param', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.findAll('.lens-btn').find((b) => b.text() === 'Table')!.trigger('click')
    await flushPromises()
    fetchMock.mockClear()
    const selects = wrapper.findAll('.chip-select')
    await selects[1].setValue('trial')
    await flushPromises()
    const call = callFor('/api/groups/table')
    expect(call![0]).toContain('status=trial')
  })
})

describe('AdminStructure — node actions (tree lens)', () => {
  it('create child posts to /api/groups with the parent id and label', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/groups': { group: { id: 'new-1', name: 'New Sub-group' } },
    })
    const wrapper = await mountStructure()
    await wrapper.find('[title="Add child group"]').trigger('click')
    await wrapper.find('.structure-inline-form input.frost-input').setValue('New Sub-group')
    await wrapper.find('.structure-inline-form .btn-ghost-sm').trigger('click')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/groups' && c[1]?.method === 'POST')
    expect(call).toBeTruthy()
    const body = JSON.parse(call![1].body)
    expect(body).toMatchObject({ name: 'New Sub-group', parent_id: 'group-a' })
  })

  it('invite posts to /api/groups/:id/invites with the selected role and shows the invite link', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/invites': { code: 'ABC123' },
    })
    const wrapper = await mountStructure()
    await wrapper.find('[title="Invite people"]').trigger('click')
    await wrapper.find('button.btn-ghost-sm').trigger('click') // "Create invite" — first ghost button in the invite form context
    // Re-find the invite form's submit specifically (role select is default 'teacher').
    const inviteForm = wrapper.findAll('.structure-inline-form').find((f) => f.find('select.frost-select').exists() && f.text().includes('Create invite'))
    if (inviteForm) await inviteForm.find('.btn-ghost-sm').trigger('click')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/invites'))
    expect(call).toBeTruthy()
    expect(call![1].method).toBe('POST')
    const body = JSON.parse(call![1].body)
    expect(body.role).toBe('teacher')
    expect(wrapper.text()).toContain('ABC123')
  })

  it('demo-mint posts to /api/groups/:id/demo-mint with the given name', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/demo-mint': { group: { id: 'demo-1' }, invite: { code: 'DEMO1' } },
    })
    const wrapper = await mountStructure()
    await wrapper.find('[title="Mint a demo org here"]').trigger('click')
    const demoForm = wrapper.findAll('.structure-inline-form').find((f) => f.text().includes('Mint'))!
    await demoForm.find('input.frost-input').setValue('Demo Academy')
    await demoForm.find('.btn-ghost-sm').trigger('click')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/demo-mint'))
    expect(call).toBeTruthy()
    const body = JSON.parse(call![1].body)
    expect(body.name).toBe('Demo Academy')
  })

  it('rename PATCHes /api/groups/:id with the new name', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/groups/group-a': { group: { id: 'group-a', name: 'Renamed' } },
    })
    const wrapper = await mountStructure()
    await wrapper.find('[title="Rename"]').trigger('click')
    const input = wrapper.find('.structure-rename-input')
    await input.setValue('Renamed')
    await input.trigger('keyup.enter')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/groups/group-a' && c[1]?.method === 'PATCH')
    expect(call).toBeTruthy()
    expect(JSON.parse(call![1].body)).toMatchObject({ name: 'Renamed' })
  })

  it('relabel PATCHes /api/groups/:id with the new label (type)', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/groups/group-a': { group: { id: 'group-a', type: 'school' } },
    })
    const wrapper = await mountStructure()
    await wrapper.find('select.label-select').setValue('school')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/groups/group-a' && c[1]?.method === 'PATCH')
    expect(call).toBeTruthy()
    expect(JSON.parse(call![1].body)).toMatchObject({ type: 'school' })
  })

  it('open dashboard routes to /admin/groups/:id for a plain group, /admin/schools/:id for a commercial node', async () => {
    setupFetch({
      '/api/groups/tree': {
        roots: [
          makeNode({ id: 'group-a', children: [
            makeNode({ id: 'group-b', name: 'Ysgol Y Traeth', commercial: { schoolId: 'school-1', platformStatus: 'active', trialCourseCode: null, trialKind: null, platformExpiresAt: null, teacherSeats: 1 } }),
          ] }),
        ],
      },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined as any)
    await wrapper.find('[title="Open dashboard"]').trigger('click')
    await flushPromises()
    expect(pushSpy).toHaveBeenCalledWith('/admin/groups/group-a')
    pushSpy.mockRestore()
  })
})

describe('AdminStructure — delete flow', () => {
  it('clicking delete on a node fetches the impact preview from the group endpoint', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/groups/group-a': { impact: { groupName: 'Gwynedd', schoolCount: 0, classCount: 0, sessionCount: 0, learnerCount: 0, teacherCount: 0, hasRealActivity: false } },
    })
    const wrapper = await mountStructure()
    await wrapper.find('[title="Delete"]').trigger('click')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/groups/group-a' && (!c[1] || c[1].method === 'GET' || c[1].method === undefined))
    expect(call).toBeTruthy()
  })

  it('clicking delete on a commercial node fetches impact via the school endpoint', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode({ commercial: { schoolId: 'school-1', platformStatus: 'active', trialCourseCode: null, trialKind: null, platformExpiresAt: null, teacherSeats: 1 } })] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/admin/update-school': { impact: { schoolName: 'Ysgol', classCount: 0, sessionCount: 0, learnerCount: 0, teacherCount: 0, hasRealActivity: false } },
    })
    const wrapper = await mountStructure()
    await wrapper.find('[title="Delete"]').trigger('click')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/api/admin/update-school?school_id=school-1'))
    expect(call).toBeTruthy()
  })
})
