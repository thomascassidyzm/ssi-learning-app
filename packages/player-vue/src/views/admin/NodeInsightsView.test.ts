/**
 * NodeInsightsView — WHERE-YOU-ARE stability (founder finding 2026-07-30:
 * hopping Overview -> Insights faked a full screen load; the rail column
 * vanished, intermediate text flashed, then the tree re-appeared).
 * Pins the ruling: the rail paints synchronously from nodeHomeCache on a
 * warm hop; a genuine cold load shows the quiet skeleton (never a text
 * flash, never the main pane sliding into the rail column); a non-OK fetch
 * drops the cache so a stale rail can't outlive access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import NodeInsightsView from './NodeInsightsView.vue'
import { cacheNodeHome, cachedRail, clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'

const routeMock = reactive({
  params: { id: 'school-1' } as Record<string, any>,
  query: {} as Record<string, any>,
  path: '/admin/schools/school-1/analytics',
})
const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}))

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

// The engine owns its own fetches/refresh — out of scope here.
vi.mock('@/insight/NodeRateEngine.vue', () => ({
  default: { name: 'NodeRateEngine', template: '<div class="engine-stub" />' },
}))

function homePayload() {
  return {
    kind: 'node',
    node: { id: 'school-node', name: 'Seaside Model School', label: 'school', hasSchool: true },
    ancestors: [{ id: 'nation', name: 'India', label: 'nation', hasSchool: false }],
    siblings: [],
    children: [{ id: 'class-1', name: 'Year 6 Hindi', label: 'class' }],
  }
}

const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}

function mountView() {
  return mount(NodeInsightsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

beforeEach(() => {
  clearNodeHomeCache()
  vi.unstubAllGlobals()
  routeMock.params = { id: 'school-1' }
  routeMock.path = '/admin/schools/school-1/analytics'
})

describe('NodeInsightsView — rail stability', () => {
  it('WARM HOP PIN: with the node cached by Overview, the rail paints synchronously — before any fetch resolves', async () => {
    cacheNodeHome('school-1', homePayload())
    // A fetch that never resolves: the rail must not depend on it.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const wrapper = mountView()
    await Promise.resolve()

    expect(wrapper.text()).toContain('Where you are')
    expect(wrapper.text()).toContain('India')
    expect(wrapper.text()).toContain("you're here")
    expect(wrapper.text()).toContain('Seaside Model School')
    expect(wrapper.find('.rail-skel').exists()).toBe(false)
    // Identity header carries the cached name too — no '…' flash.
    expect(wrapper.find('.identity-name').text()).toBe('Seaside Model School')
  })

  it('COLD LOAD: the rail column still exists (quiet skeleton, no text flash), then the tree lands once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => homePayload() })))
    const wrapper = mountView()

    // Before data: the aside renders with the skeleton — the main pane never
    // slides into the rail column.
    expect(wrapper.find('aside.rail-col').exists()).toBe(true)
    expect(wrapper.find('.rail-skel').exists()).toBe(true)

    await flushPromises()
    expect(wrapper.find('.rail-skel').exists()).toBe(false)
    expect(wrapper.text()).toContain("you're here")
    // And the visit is now cached for the hop back to Overview.
    expect(cachedRail('school-1')?.node.name).toBe('Seaside Model School')
  })

  it('HONESTY PIN: a non-OK fetch drops the cached node — a stale rail never outlives access', async () => {
    cacheNodeHome('school-1', homePayload())
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const wrapper = mountView()
    await flushPromises()

    expect(cachedRail('school-1')).toBeNull()
    expect(wrapper.find('.rail-skel').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Seaside Model School')
  })
})

/**
 * A CLASS HAS NO JOURNEY FOLD (Tom, 2026-09-17, shape B). The journey question
 * is answered on the class's own Overview, as the Course journey card drawn as
 * the brain. A funnel of one account here would be that number said twice, so
 * the line is not on the page at all — and nothing is read for it. Above class
 * level it is untouched, because there the funnel has more than one class in it.
 */
describe('NodeInsightsView — the class-level journey fold', () => {
  function classPayload() {
    return {
      kind: 'class',
      node: { id: 'class-1', name: 'Year 6 Hindi', label: 'class' },
      ancestors: [{ id: 'school-node', name: 'Seaside Model School', label: 'school', hasSchool: true }],
      siblings: [],
      children: [],
    }
  }

  it('drops the fold on a class, and never asks the server the journey question', async () => {
    routeMock.params = { id: 'class-1' }
    routeMock.path = '/admin/classes/class-1/insights'
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => classPayload() }))
    vi.stubGlobal('fetch', fetchMock as never)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-walk="insights-more"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('More about this level')
    expect(fetchMock.mock.calls.some((args: unknown[]) => String(args[0]).includes('/api/org/intel'))).toBe(false)
  })

  it('keeps the fold above class level, where a funnel has more than one class in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => homePayload() })) as never)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-walk="insights-more"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('More about this level')
  })
})
