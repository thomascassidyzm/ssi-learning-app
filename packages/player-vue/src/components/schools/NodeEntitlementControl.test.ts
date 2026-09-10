import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeEntitlementControl from './NodeEntitlementControl.vue'

const COURSES = [
  { course_code: 'spa_for_eng', display_name: 'Spanish', known_lang: 'eng', target_lang: 'spa', pricing_tier: 'premium' },
  { course_code: 'cym_for_eng', display_name: 'Welsh', known_lang: 'eng', target_lang: 'cym', pricing_tier: 'free' },
]
// The two live Welsh dialects, which share a language pair — they are only
// told apart by their display names.
const WELSH_DIALECTS = [
  { course_code: 'cym_n_for_eng', display_name: 'North Welsh for English Speakers', known_lang: 'eng', target_lang: 'cym', pricing_tier: 'premium' },
  { course_code: 'cym_s_for_eng', display_name: 'South Welsh for English Speakers', known_lang: 'eng', target_lang: 'cym', pricing_tier: 'premium' },
]
let catalogue: typeof COURSES = COURSES

function mockSupabaseClient() {
  return {
    from: (table: string) => {
      if (table !== 'courses') throw new Error(`unexpected table ${table}`)
      const builder: any = {
        select: () => builder,
        in: () => builder,
        order: () => Promise.resolve({ data: catalogue, error: null }),
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

// A group node also reads its org enrolment policy (the Canolfan case). By
// default there isn't one, which is the ordinary case for every other group.
function policyResponse(policy: any) {
  return { ok: true, json: async () => ({ policy }) }
}

beforeEach(() => {
  catalogue = COURSES
  fetchMock = vi.fn(async () => policyResponse(null))
  vi.stubGlobal('fetch', fetchMock)
})

function callTo(fragment: string) {
  return fetchMock.mock.calls.find((c) => String(c[0]).includes(fragment))
}
// The save is the only POST — matching on the URL alone would also match the
// grants GET that shares its prefix.
function savePost() {
  return fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NodeEntitlementControl', () => {
  it('shows "not set" with no existing grant', async () => {
    fetchMock.mockResolvedValueOnce(grantsResponse([]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Not set')
    expect(wrapper.text()).toContain('No course access set yet')
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

    const saveCall = savePost()
    expect(saveCall[0]).toBe('/api/entitlement/grant')
    const body = JSON.parse(saveCall[1].body)
    expect(body).toMatchObject({ group_id: 'g1', state: 'trial', course_code: 'spa_for_eng' })
  })

  // Welsh is PRICED premium and yet takes the year window, because trial
  // length follows the target language and cym is not a Big-10 one. The
  // preview used to read the pricing tier and so promised an operator 30 days
  // while the server wrote 365.
  it('previews a full year for Welsh, whose pricing tier says premium', async () => {
    catalogue = WELSH_DIALECTS
    fetchMock.mockResolvedValueOnce(grantsResponse([]))
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()

    await wrapper.findAll('.course-option')[0].trigger('click')
    expect(wrapper.find('.expiry-preview').text()).toContain('365')
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

    const saveCall = savePost()
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

  // Kai, 2026-09-08: opening the Canolfan group showed no course access at all,
  // while its learners were each being given two Welsh courses at sign-up. The
  // grant read was right; the org grants through its enrolment policy instead,
  // and nothing read that. This is the display that was missing.
  it('shows the courses an org enrolment policy grants at sign-up', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/admin/org-enrolment-setup')) {
        return policyResponse({
          org_display_name: 'Y Ganolfan Dysgu Cymraeg Genedlaethol',
          free_months: 12,
          granted_courses: ['cym_n_for_eng', 'cym_s_for_eng'],
          is_active: true,
        })
      }
      return grantsResponse([])
    })
    catalogue = WELSH_DIALECTS
    const wrapper = mount(NodeEntitlementControl, {
      props: { nodeId: '673b0490-81a8-4f83-a2a9-c2e87baf1ec3', nodeType: 'group' },
    })
    await flushPromises()

    expect(callTo('/api/admin/org-enrolment-setup')).toBeTruthy()
    expect(wrapper.text()).toContain('Granted at sign-up')
    expect(wrapper.text()).toContain('Y Ganolfan Dysgu Cymraeg Genedlaethol')
    expect(wrapper.text()).toContain('12 months free')
    // Both dialects, told apart — not "Welsh for English speakers" twice.
    expect(wrapper.text()).toContain('North Welsh for English Speakers')
    expect(wrapper.text()).toContain('South Welsh for English Speakers')
    // ...and the misleading line it replaces is gone.
    expect(wrapper.text()).not.toContain('No course access set yet')
  })

  it('leaves a group with no enrolment policy reading "Not set"', async () => {
    const wrapper = mount(NodeEntitlementControl, { props: { nodeId: 'g9', nodeType: 'group' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Not set')
    expect(wrapper.text()).toContain('No course access set yet')
  })
})
