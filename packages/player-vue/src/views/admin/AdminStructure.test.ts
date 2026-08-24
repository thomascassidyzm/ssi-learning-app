/**
 * Tests for AdminStructure.vue — the Structure surface's two lenses
 * (THE-MODEL.md §1.9/§6/§7): table + tree on the same /api/groups/tree and
 * /api/groups/table data, shared search + filter chips, and the row
 * maintenance actions (relabel, rename, delete, drill-in). Create/invite/
 * demo-mint moved to the node home's action bar (founder pass C 2026-07-19)
 * and are covered by NodeActionBar's usage.
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

  it('sends the session token on the data calls — Authorization: Bearer on mount (FABLE incident 2 regression)', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    const treeCall = callFor('/api/groups/tree')
    expect(treeCall![1]?.headers?.Authorization).toBe('Bearer test-token')
    // With a valid session the page shows data, not the error banner.
    expect(wrapper.text()).toContain('Gwynedd')
    expect(wrapper.find('.banner-error').exists()).toBe(false)
  })

  it('surfaces the server auth error in the banner when the session is rejected (401)', async () => {
    fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Your session has ended — sign in again' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountStructure()
    expect(wrapper.find('.banner-error').text()).toBe('Your session has ended — sign in again')
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
    await wrapper.find('.structure-search-input').setValue('gwynedd')
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

  it('the Trial chip re-fetches the table lens with the status param', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.findAll('.lens-btn').find((b) => b.text() === 'Table')!.trigger('click')
    await flushPromises()
    fetchMock.mockClear()
    await wrapper.findAll('.chip').find((b) => b.text() === 'Trial')!.trigger('click')
    await flushPromises()
    const call = callFor('/api/groups/table')
    expect(call![0]).toContain('status=trial')
  })

  it('filters the tree lens to matching root-level orgs client-side (bug: search did nothing in Tree — root nodes were never filtered, only their children)', async () => {
    setupFetch({
      '/api/groups/tree': {
        roots: [
          makeNode({ id: 'group-a', name: 'Ysgol Cas-gwent Chepstow School' }),
          makeNode({ id: 'group-b', name: 'Ysgol Y Traeth' }),
          makeNode({ id: 'group-c', name: 'Gwynedd' }),
        ],
      },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    expect(wrapper.text()).toContain('Ysgol Y Traeth')
    expect(wrapper.text()).toContain('Gwynedd')

    await wrapper.find('.structure-search-input').setValue('chepstow')
    await flushPromises()

    expect(wrapper.text()).toContain('Ysgol Cas-gwent Chepstow School')
    expect(wrapper.text()).not.toContain('Ysgol Y Traeth')
    expect(wrapper.text()).not.toContain('Gwynedd')
  })

  it('keeps ancestor context when a deep descendant matches the tree search', async () => {
    setupFetch({
      '/api/groups/tree': {
        roots: [
          makeNode({
            id: 'group-a', name: 'Wales',
            rollup: { childGroupCount: 1, teacherCount: 0, classCount: 0, learnerCount: 0 },
            children: [makeNode({ id: 'group-b', name: 'Ysgol Cas-gwent Chepstow School' })],
          }),
          makeNode({ id: 'group-c', name: 'Unrelated Org' }),
        ],
      },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.find('.structure-search-input').setValue('chepstow')
    await flushPromises()

    expect(wrapper.text()).toContain('Wales')
    expect(wrapper.text()).toContain('Ysgol Cas-gwent Chepstow School')
    expect(wrapper.text()).not.toContain('Unrelated Org')
  })

  it('the Schools chip re-fetches the table lens with the bucket param', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.findAll('.lens-btn').find((b) => b.text() === 'Table')!.trigger('click')
    await flushPromises()
    fetchMock.mockClear()
    await wrapper.findAll('.chip').find((b) => b.text() === 'Schools')!.trigger('click')
    await flushPromises()
    const call = callFor('/api/groups/table')
    expect(call![0]).toContain('bucket=school')
  })
})


async function clickOverflowItem(wrapper: any, label: string): Promise<void> {
  await wrapper.find('.overflow-toggle').trigger('click')
  const item = wrapper.findAll('.overflow-item').find((b: any) => b.text() === label)!
  await item.trigger('click')
}

describe('AdminStructure — node actions (tree lens)', () => {
  // Structure verbs (add child / invite / demo-mint) moved to the node
  // home's action bar (NodeActionBar) — founder pass C, 2026-07-19. Rows
  // keep only maintenance verbs: Rename · Change label · Delete.
  it('the ⋯ menu carries only maintenance verbs — no create/invite/mint on rows', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    await wrapper.find('.overflow-toggle').trigger('click')
    const items = wrapper.findAll('.overflow-item').map((b: any) => b.text())
    expect(items).toEqual(['Rename', 'Change label', 'Delete'])
  })

  it('rename PATCHes /api/groups/:id with the new name', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
      '/api/groups/group-a': { group: { id: 'group-a', name: 'Renamed' } },
    })
    const wrapper = await mountStructure()
    await clickOverflowItem(wrapper, 'Rename')
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
    await clickOverflowItem(wrapper, 'Change label')
    await wrapper.find('select.label-select').setValue('school')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/groups/group-a' && c[1]?.method === 'PATCH')
    expect(call).toBeTruthy()
    expect(JSON.parse(call![1].body)).toMatchObject({ type: 'school' })
  })

  it('clicking a row (rows are links) routes to /admin/groups/:id for a plain group', async () => {
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
    await wrapper.find('.structure-row').trigger('click')
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
    await clickOverflowItem(wrapper, 'Delete')
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
    await clickOverflowItem(wrapper, 'Delete')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/api/admin/update-school?school_id=school-1'))
    expect(call).toBeTruthy()
  })
})

describe('AdminStructure — duplicate org-name warning (Deborah, 2026-08-06)', () => {
  const dupBody = {
    error: 'server sentence',
    code: 'duplicate_name',
    duplicates: [{ name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z' }],
  }

  // Answers the tree/table reads normally, 409s the FIRST create, and 201s any
  // create that carries confirm_duplicate — exactly the server's contract.
  function setupCreateFetch() {
    const posts: any[] = []
    fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/groups') && init?.method === 'POST') {
        const body = JSON.parse(init.body)
        posts.push(body)
        if (body.confirm_duplicate) {
          return { ok: true, status: 201, json: async () => ({ group: { id: 'g2', name: body.name } }) }
        }
        return { ok: false, status: 409, json: async () => dupBody }
      }
      if (url.includes('/tree')) return { ok: true, status: 200, json: async () => ({ nodes: [makeNode()] }) }
      return { ok: true, status: 200, json: async () => ({ rows: [], total: 0 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    return posts
  }

  async function openAddOrgAndSubmit(wrapper: any, name: string) {
    await wrapper.findAll('button').find((b: any) => b.text().includes('Add organisation'))!.trigger('click')
    await wrapper.find('input.frost-input').setValue(name)
    await flushPromises()
    await wrapper.findAll('button').find((b: any) => b.text() === 'Add')!.trigger('click')
    await flushPromises()
  }

  it('shows a plain warning instead of a raw error, and creates nothing', async () => {
    const posts = setupCreateFetch()
    const wrapper = await mountStructure()
    await openAddOrgAndSubmit(wrapper, 'Deborah Testing')

    expect(wrapper.text()).toContain('There\'s already an organisation called "Deborah Testing"')
    expect(wrapper.text()).toContain('created on 5 August 2026')
    // The server's own sentence is never surfaced raw.
    expect(wrapper.text()).not.toContain('server sentence')
    expect(posts).toHaveLength(1)
    expect(posts[0].confirm_duplicate).toBeUndefined()
  })

  it('"Go ahead anyway" re-sends the SAME request with confirm_duplicate and creates it', async () => {
    const posts = setupCreateFetch()
    const wrapper = await mountStructure()
    await openAddOrgAndSubmit(wrapper, 'Deborah Testing')

    await wrapper.findAll('button').find((b: any) => b.text().includes('Go ahead anyway'))!.trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(2)
    expect(posts[1]).toMatchObject({ name: 'Deborah Testing', confirm_duplicate: true })
    expect(wrapper.text()).not.toContain('will give you two with the same name')
  })

  it('"Change the name" clears the warning without creating anything', async () => {
    const posts = setupCreateFetch()
    const wrapper = await mountStructure()
    await openAddOrgAndSubmit(wrapper, 'Deborah Testing')

    await wrapper.findAll('button').find((b: any) => b.text() === 'Change the name')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('will give you two with the same name')
    expect(posts).toHaveLength(1)
  })

  it('editing the name drops the stale warning', async () => {
    setupCreateFetch()
    const wrapper = await mountStructure()
    await openAddOrgAndSubmit(wrapper, 'Deborah Testing')
    expect(wrapper.text()).toContain('will give you two with the same name')

    await wrapper.find('input.frost-input').setValue('Deborah Testing 2')
    await flushPromises()
    expect(wrapper.text()).not.toContain('will give you two with the same name')
  })

  it('pressing Enter never counts as confirmation — the KeyboardEvent must not become confirm_duplicate', async () => {
    const posts = setupCreateFetch()
    const wrapper = await mountStructure()
    await wrapper.findAll('button').find((b: any) => b.text().includes('Add organisation'))!.trigger('click')
    await wrapper.find('input.frost-input').setValue('Deborah Testing')
    await flushPromises()
    await wrapper.find('input.frost-input').trigger('keyup.enter')
    await flushPromises()
    expect(posts).toHaveLength(1)
    expect(posts[0].confirm_duplicate).toBeUndefined()
    expect(wrapper.text()).toContain('will give you two with the same name')
  })

  it('a non-colliding name creates with no confirmation step at all', async () => {
    const posts: any[] = []
    fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/groups') && init?.method === 'POST') {
        posts.push(JSON.parse(init.body))
        return { ok: true, status: 201, json: async () => ({ group: { id: 'g9', name: 'Cardiff Council' } }) }
      }
      if (url.includes('/tree')) return { ok: true, status: 200, json: async () => ({ nodes: [makeNode()] }) }
      return { ok: true, status: 200, json: async () => ({ rows: [], total: 0 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountStructure()
    await openAddOrgAndSubmit(wrapper, 'Cardiff Council')

    expect(posts).toHaveLength(1)
    expect(wrapper.text()).toContain('created')
    expect(wrapper.text()).not.toContain('Go ahead anyway')
  })
})

/**
 * The same warning on RENAME (2026-08-06) — PATCH /api/groups/:id answers the
 * same 409 `duplicate_name`, read by the same readDuplicateWarning, with the
 * same two ways out. A rename warning that looked or behaved differently from
 * a create warning on the same screen would be a defect.
 */
describe('AdminStructure — duplicate-name warning on rename', () => {
  const dupBody = {
    error: 'server sentence',
    code: 'duplicate_name',
    duplicates: [{ id: 'group-b', name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z' }],
  }

  // 409s the first PATCH, 200s any PATCH carrying confirm_duplicate.
  function setupRenameFetch() {
    const patches: any[] = []
    fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/groups/group-a') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body)
        patches.push(body)
        if (body.confirm_duplicate) {
          return { ok: true, status: 200, json: async () => ({ group: { id: 'group-a', name: body.name } }) }
        }
        return { ok: false, status: 409, json: async () => dupBody }
      }
      if (url.includes('/api/groups/tree')) return { ok: true, status: 200, json: async () => ({ roots: [makeNode()] }) }
      return { ok: true, status: 200, json: async () => ({ rows: [], total: 0, page: 1, pageSize: 25 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    return patches
  }

  async function renameTo(wrapper: any, name: string) {
    await clickOverflowItem(wrapper, 'Rename')
    const input = wrapper.find('.structure-rename-input')
    await input.setValue(name)
    await input.trigger('keyup.enter')
    await flushPromises()
  }

  it('shows the warning instead of a raw error, and renames nothing', async () => {
    const patches = setupRenameFetch()
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Deborah Testing')

    expect(wrapper.text()).toContain('There\'s already an organisation called "Deborah Testing"')
    expect(wrapper.text()).toContain('created on 5 August 2026')
    expect(wrapper.text()).not.toContain('server sentence')
    expect(patches).toHaveLength(1)
    expect(patches[0].confirm_duplicate).toBeUndefined()
  })

  it('pressing Enter never counts as confirmation — the KeyboardEvent must not become confirm_duplicate', async () => {
    const patches = setupRenameFetch()
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Deborah Testing')
    // Enter is what submitted the rename above; it must have warned, not confirmed.
    expect(patches).toHaveLength(1)
    expect(patches[0]).toEqual({ name: 'Deborah Testing' })
    expect(wrapper.text()).toContain('Renaming this one will give you two with the same name')
  })

  it('"Go ahead anyway" re-sends the SAME rename with confirm_duplicate', async () => {
    const patches = setupRenameFetch()
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Deborah Testing')

    await wrapper.findAll('button').find((b: any) => b.text().includes('Go ahead anyway'))!.trigger('click')
    await flushPromises()

    expect(patches).toHaveLength(2)
    expect(patches[1]).toMatchObject({ name: 'Deborah Testing', confirm_duplicate: true })
    expect(wrapper.text()).not.toContain('will give you two with the same name')
  })

  it('"Change the name" reopens the rename input on the typed name and sends nothing', async () => {
    const patches = setupRenameFetch()
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Deborah Testing')

    await wrapper.findAll('button').find((b: any) => b.text() === 'Change the name')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('will give you two with the same name')
    expect(wrapper.find('.structure-rename-input').exists()).toBe(true)
    expect((wrapper.find('.structure-rename-input').element as HTMLInputElement).value).toBe('Deborah Testing')
    expect(patches).toHaveLength(1)
  })

  it('a fresh name after the warning is sent fresh — never as a confirmation', async () => {
    const patches = setupRenameFetch()
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Deborah Testing')
    expect(wrapper.text()).toContain('Renaming this one will give you two with the same name')

    await wrapper.findAll('button').find((b: any) => b.text() === 'Change the name')!.trigger('click')
    await flushPromises()
    const input = wrapper.find('.structure-rename-input')
    await input.setValue('Deborah Testing 2')
    await flushPromises()
    expect(wrapper.text()).not.toContain('will give you two with the same name')

    await input.trigger('keyup.enter')
    await flushPromises()
    expect(patches).toHaveLength(2)
    expect(patches[1]).toEqual({ name: 'Deborah Testing 2' })
  })

  it('a non-colliding rename goes straight through, no confirmation step', async () => {
    const patches: any[] = []
    fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/groups/group-a') && init?.method === 'PATCH') {
        patches.push(JSON.parse(init.body))
        return { ok: true, status: 200, json: async () => ({ group: { id: 'group-a', name: 'Cardiff Council' } }) }
      }
      if (url.includes('/api/groups/tree')) return { ok: true, status: 200, json: async () => ({ roots: [makeNode()] }) }
      return { ok: true, status: 200, json: async () => ({ rows: [], total: 0, page: 1, pageSize: 25 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Cardiff Council')

    expect(patches).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Go ahead anyway')
  })

  it('leaves the OTHER errors on the endpoint alone — a 403 still surfaces as an error', async () => {
    fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/groups/group-a') && init?.method === 'PATCH') {
        return { ok: false, status: 403, json: async () => ({ error: 'You do not govern this group' }) }
      }
      if (url.includes('/api/groups/tree')) return { ok: true, status: 200, json: async () => ({ roots: [makeNode()] }) }
      return { ok: true, status: 200, json: async () => ({ rows: [], total: 0, page: 1, pageSize: 25 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountStructure()
    await renameTo(wrapper, 'Anything')
    expect(wrapper.text()).toContain('You do not govern this group')
    expect(wrapper.text()).not.toContain('Go ahead anyway')
  })
})

// Adding one human should cost what adding one school costs (founder ask
// 2026-08-11): the individual verb is a peer of "+ Add organisation" on this
// page, not three levels down a menu.
describe('AdminStructure — "+ Add individual"', () => {
  it('offers the individual verb alongside "+ Add organisation"', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    const labels = wrapper.findAll('.head-actions button').map((b) => b.text())
    expect(labels).toContain('+ Add organisation')
    expect(labels).toContain('+ Add individual')
  })

  it('opens the person-first grant form inline — course, duration and sign-up cap, no trial', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [], total: 0, page: 1, pageSize: 25 },
    })
    const wrapper = await mountStructure()
    expect(wrapper.find('.individual-panel').exists()).toBe(false)

    const addIndividual = wrapper.findAll('.head-actions button').find((b) => b.text() === '+ Add individual')
    await addIndividual!.trigger('click')
    await flushPromises()

    const panel = wrapper.find('.individual-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('Sign-ups')
    expect(panel.text()).toContain('For how long')
    expect(panel.text()).toContain('do not get a trial')
  })
})
