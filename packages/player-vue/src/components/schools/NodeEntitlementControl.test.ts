import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeEntitlementControl from './NodeEntitlementControl.vue'

const COURSES = [
  { course_code: 'spa_for_eng', display_name: 'Spanish', known_lang: 'eng', target_lang: 'spa', pricing_tier: 'premium' },
  { course_code: 'cym_for_eng', display_name: 'Welsh', known_lang: 'eng', target_lang: 'cym', pricing_tier: 'free' },
]

function mockSupabaseClient() {
  return {
    from: (table: string) => {
      if (table !== 'courses') throw new Error(`unexpected table ${table}`)
      const builder: any = {
        select: () => builder,
        in: () => builder,
        order: () => Promise.resolve({ data: COURSES, error: null }),
      }
      return builder
    },
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
  }
}

let fetchMock: ReturnType<typeof vi.fn>

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => mockSupabaseClient(),
    getAuthToken: async () => 'tok',
  }),
}))

function grantsResponse(grants: any[]) {
  return { ok: true, json: async () => ({ grants }) }
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NodeEntitlementControl', () => {
  it('shows "not set" with no existing grant', async () => {
    fetchMock.mockResolvedValueOnce(grantsResponse([]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Not set')
    expect(wrapper.text()).toContain('No entitlement set yet')
  })

  it('shows the trial state with its course and expiry', async () => {
    const expires = new Date(Date.now() + 30 * 86400000).toISOString()
    fetchMock.mockResolvedValueOnce(grantsResponse([
      { id: 'g1', state: 'trial', granted_courses: ['spa_for_eng'], expires_at: expires },
    ]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Trial')
    expect(wrapper.text()).toContain('Spanish')
  })

  it('shows the paid state with no course list', async () => {
    fetchMock.mockResolvedValueOnce(grantsResponse([
      { id: 'g1', state: 'paid', granted_courses: ['spa_for_eng', 'cym_for_eng'], expires_at: null },
    ]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Paid')
    expect(wrapper.text()).toContain('All courses, no expiry')
    expect(wrapper.find('.course-list').exists()).toBe(false)
  })

  it('saving a trial pick posts state/course_code scoped to the node', async () => {
    fetchMock.mockResolvedValueOnce(grantsResponse([]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 'g1', nodeType: 'group' } })
    await flushPromises()

    // default pendingState is 'trial'; pick a course from the fetched catalogue.
    const options = wrapper.findAll('.course-option')
    expect(options.length).toBe(2)
    await options[0].trigger('click')

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ grant: { id: 'g1', state: 'trial', granted_courses: ['spa_for_eng'], expires_at: new Date().toISOString() }, created: true }),
    })
    await wrapper.find('.state-toggle .state-option.is-selected').exists() // sanity
    await wrapper.findAll('.state-option')[0].trigger('click') // ensure trial selected
    await wrapper.find('.facet-actions button').trigger('click')
    await flushPromises()

    const [, saveCall] = fetchMock.mock.calls
    expect(saveCall[0]).toBe('/api/entitlement/grant')
    const body = JSON.parse(saveCall[1].body)
    expect(body).toMatchObject({ group_id: 'g1', state: 'trial', course_code: 'spa_for_eng' })
  })

  it('saving a paid pick omits course_code', async () => {
    fetchMock.mockResolvedValueOnce(grantsResponse([]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 'c1', nodeType: 'class' } })
    await flushPromises()

    await wrapper.findAll('.state-option')[1].trigger('click') // select 'Paid'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ grant: { id: 'g1', state: 'paid', granted_courses: ['spa_for_eng', 'cym_for_eng'], expires_at: null }, created: true }),
    })
    await wrapper.find('.facet-actions button').trigger('click')
    await flushPromises()

    const [, saveCall] = fetchMock.mock.calls
    const body = JSON.parse(saveCall[1].body)
    expect(body).toEqual({ class_id: 'c1', state: 'paid' })
  })

  it('blocks saving a trial with no course selected', async () => {
    fetchMock.mockResolvedValueOnce(grantsResponse([]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()

    await wrapper.find('.facet-actions button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Pick a course for the trial')
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial grants fetch, no save POST
  })
})
