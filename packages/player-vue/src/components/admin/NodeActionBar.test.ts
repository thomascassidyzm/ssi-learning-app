/**
 * Tests for NodeActionBar's RENAME verb and its duplicate-name warning
 * (2026-08-06). PATCH /api/groups/:id answers 409 `duplicate_name` when the
 * new name slugs onto a sibling's; the bar shows the same warning the Add-a-
 * group form shows, with the same two ways out — change the name, or go ahead
 * anyway, which re-sends the identical request with confirm_duplicate: true.
 *
 * The Enter case is pinned deliberately: @keyup.enter="submitRename" (no
 * parens) would pass the KeyboardEvent as `confirmDuplicate`, and a
 * KeyboardEvent is truthy — pressing Enter would then silently confirm a
 * duplicate, which is exactly the failure this work exists to close.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeActionBar from './NodeActionBar.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => ({}),
    getAuthToken: async () => 'test-token',
  }),
}))

const dupBody = {
  error: 'server sentence',
  code: 'duplicate_name',
  duplicates: [{ name: 'Ward 1', created_at: '2026-08-05T10:00:00Z' }],
}

let patches: any[] = []

/** 409s the first rename, 200s any rename carrying confirm_duplicate. */
function setupFetch(renameResponse?: (body: any) => any) {
  patches = []
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (url.includes('/api/groups/group-a') && init?.method === 'PATCH') {
      const body = JSON.parse(init.body)
      patches.push(body)
      if (renameResponse) return renameResponse(body)
      if (body.confirm_duplicate) {
        return { ok: true, status: 200, json: async () => ({ group: { id: 'group-a', name: body.name } }) }
      }
      return { ok: false, status: 409, json: async () => dupBody }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
}

function mountBar() {
  return mount(NodeActionBar, {
    props: { node: { id: 'group-a', name: 'Gwynedd', label: 'group' } },
    global: { stubs: { NodeEntitlementControl: true, ConfirmDeleteModal: true } },
  })
}

async function openRenameAndSubmit(wrapper: any, name: string, via: 'enter' | 'button' = 'enter') {
  await wrapper.findAll('button').find((b: any) => b.text() === 'Rename')!.trigger('click')
  const input = wrapper.find('input.frost-input')
  await input.setValue(name)
  await flushPromises()
  if (via === 'enter') await input.trigger('keyup.enter')
  else await wrapper.findAll('button').find((b: any) => b.text() === 'Save')!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('NodeActionBar — duplicate-name warning on rename', () => {
  it('shows the warning instead of a raw error, and renames nothing', async () => {
    setupFetch()
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 1')

    expect(wrapper.text()).toContain('There\'s already a group called "Ward 1"')
    expect(wrapper.text()).toContain('created on 5 August 2026')
    expect(wrapper.text()).not.toContain('server sentence')
    expect(patches).toHaveLength(1)
    expect(patches[0]).toEqual({ name: 'Ward 1' })
  })

  it('pressing Enter never counts as confirmation — the KeyboardEvent must not become confirm_duplicate', async () => {
    setupFetch()
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 1', 'enter')
    expect(patches[0].confirm_duplicate).toBeUndefined()
    expect(wrapper.text()).toContain('will give you two with the same name')

    // And Enter a second time, with the warning on screen, still doesn't confirm.
    await wrapper.find('input.frost-input').trigger('keyup.enter')
    await flushPromises()
    expect(patches.every((p) => p.confirm_duplicate === undefined)).toBe(true)
  })

  it('clicking Save never confirms either', async () => {
    setupFetch()
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 1', 'button')
    expect(patches[0].confirm_duplicate).toBeUndefined()
  })

  it('"Go ahead anyway" re-sends the SAME rename with confirm_duplicate', async () => {
    setupFetch()
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 1')

    await wrapper.findAll('button').find((b: any) => b.text().includes('Go ahead anyway'))!.trigger('click')
    await flushPromises()

    expect(patches).toHaveLength(2)
    expect(patches[1]).toMatchObject({ name: 'Ward 1', confirm_duplicate: true })
    expect(wrapper.text()).not.toContain('will give you two with the same name')
    expect(wrapper.text()).toContain('Renamed to "Ward 1"')
  })

  it('"Change the name" clears the warning and sends nothing', async () => {
    setupFetch()
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 1')

    await wrapper.findAll('button').find((b: any) => b.text() === 'Change the name')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('will give you two with the same name')
    expect(patches).toHaveLength(1)
  })

  it('editing the name drops the stale warning', async () => {
    setupFetch()
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 1')
    expect(wrapper.text()).toContain('will give you two with the same name')

    await wrapper.find('input.frost-input').setValue('Ward 2')
    await flushPromises()
    expect(wrapper.text()).not.toContain('will give you two with the same name')
  })

  it('a non-colliding rename goes straight through, no confirmation step', async () => {
    setupFetch((body) => ({ ok: true, status: 200, json: async () => ({ group: { id: 'group-a', name: body.name } }) }))
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 9')

    expect(patches).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Go ahead anyway')
    expect(wrapper.text()).toContain('Renamed to "Ward 9"')
  })

  it('leaves the endpoint\'s other errors alone — a 403 still surfaces as an error', async () => {
    setupFetch(() => ({ ok: false, status: 403, json: async () => ({ error: 'You do not govern this group' }) }))
    const wrapper = mountBar()
    await openRenameAndSubmit(wrapper, 'Ward 3')
    expect(wrapper.text()).toContain('You do not govern this group')
    expect(wrapper.text()).not.toContain('Go ahead anyway')
  })
})
