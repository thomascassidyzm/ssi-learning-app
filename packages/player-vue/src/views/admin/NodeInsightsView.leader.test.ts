/**
 * NodeInsightsView as the LEADER'S PAGE (Tom via RBF, 2026-09-16): the card,
 * then one card per class quietest first, and everything else behind a tap.
 * The per-pupil list is who has NOT practised, by name — never a table
 * ranked by minutes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, defineComponent, h, onMounted } from 'vue'
import NodeInsightsView from './NodeInsightsView.vue'
import { clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'

const routeMock = reactive({ params: { id: 'school-1' } as Record<string, any>, query: {} as Record<string, any>, path: '/org/school-1/insights' })
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/composables/useAdminClient', () => ({ useAdminClient: () => ({ getAuthToken: async () => 'tok' }) }))

const DAY = 86_400_000
const weekClasses = [
  { id: 'q', name: 'Grade 7A', started: true, lastPlayedAt: new Date(Date.now() - 20 * DAY).toISOString(), classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0 },
  { id: 'b', name: 'Grade 6A', started: true, lastPlayedAt: new Date(Date.now() - DAY).toISOString(), classMinutes: 40, pupilMinutes: 5, totalMinutes: 45, newPhrases: 9 },
  { id: 'n', name: 'Grade 6B', started: false, lastPlayedAt: null, classMinutes: null, pupilMinutes: null, totalMinutes: null, newPhrases: null },
]
// The engine stub emits the one round trip's body, as the real one does.
vi.mock('@/insight/NodeRateEngine.vue', () => ({
  default: defineComponent({
    name: 'NodeRateEngine',
    emits: ['data', 'state'],
    setup(_, { emit }) {
      onMounted(() => {
        emit('state', { node: { id: 'school-node', name: 'Sunrise', label: 'school', kind: 'node' }, options: { courses: [], compares: [] }, applied: { course_code: 'eng_for_hin', compare_to: 'x', days: 7, window: 'this_week' } })
        emit('data', { week: { label: 'This week', classes: weekClasses } })
      })
      return () => h('div', { class: 'engine-stub' })
    },
  }),
}))
vi.mock('@/insight/data/orgIntel', () => ({
  OrgIntelError: class extends Error {},
  fetchOrgIntel: async () => ({
    node: { id: 'school-node', name: 'Sunrise', kind: 'school' }, windowDays: 7, lookbackDays: 28, countedAt: new Date().toISOString(),
    practising: { classCount: 3, classesThisWeek: 1, classesLastWeek: 1, phrasesThisWeek: 9, phrasesLastWeek: 3, classMinutesThisWeek: 40, classMinutesLastWeek: 10, peopleCount: 3, peopleThisWeek: 1, peopleLastWeek: 0, ownMinutesThisWeek: 5, ownMinutesLastWeek: 0 },
    byDay: [], quiet: { quietCount: 1, neverCount: 1, buckets: [] }, journey: { courses: [], stages: [] },
    classes: [],
    people: [
      { learnerId: 'p1', name: 'Zara', minutesThisWeek: 0, minutesLastWeek: 0, lastPractisedDay: null },
      { learnerId: 'p2', name: 'Arjun', minutesThisWeek: 0, minutesLastWeek: 4, lastPractisedDay: '2026-09-01' },
      { learnerId: 'p3', name: 'Meera', minutesThisWeek: 55, minutesLastWeek: 0, lastPractisedDay: '2026-09-15' },
    ],
  }),
}))
vi.mock('@/insight/data/vadScope', () => ({ fetchVadScope: async () => ({ scope: { kind: 'school', label: 'Sunrise', learnerIds: [], classes: [] }, names: {}, metricsByLearner: {}, prosodyByLearner: {}, prosodyAvailable: false }) }))
vi.mock('@/insight/data/vadUptake', () => ({ summariseVad: () => null }))
vi.mock('@/insight/VadPanel.vue', () => ({ default: { name: 'VadPanel', template: '<div class="vad-stub" />' } }))
vi.mock('@/insight/OrgIntelPanel.vue', () => ({ default: { name: 'OrgIntelPanel', props: ['payload', 'hidePeople'], template: '<div class="oq-stub" :data-hide-people="String(hidePeople)" />' } }))

const RouterLinkStub = { props: { to: { type: [String, Object], required: true } }, template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>` }

beforeEach(() => {
  clearNodeHomeCache()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'node', node: { id: 'school-node', name: 'Sunrise', label: 'school', hasSchool: true }, ancestors: [], siblings: [], children: [] }) })))
})

describe('NodeInsightsView — the leader’s page', () => {
  it('opens on the card, then every class quietest first; nothing else on the first screen', async () => {
    const w = mount(NodeInsightsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    const order = w.findAll('.cwl-card .cwl-name').map((n) => n.text())
    expect(order).toEqual(['Grade 7A', 'Grade 6A'])
    expect(w.find('.cwl-quiet-sum').text()).toBe('1 class has not started yet')
    // the org questions, the not-practised list and voice all sit behind a tap
    for (const d of w.findAll('details.niv-more')) expect(d.attributes('open')).toBeUndefined()
    expect(w.find('.oq-stub').attributes('data-hide-people')).toBe('true')
  })

  it('who has not practised: by name, never by minutes, and framed as absence', async () => {
    const w = mount(NodeInsightsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    const d = w.find('[data-walk="insights-not-practised"]')
    expect(d.find('.niv-more-title').text()).toBe('Who has not practised this week')
    expect(d.find('.niv-more-count').text()).toBe('2 of 3')
    expect(d.findAll('.niv-names li').map((li) => li.text())).toEqual(['Arjun', 'Zara'])
    expect(d.text()).not.toContain('Meera')
    expect(d.text()).not.toMatch(/\b\d+ ?min\b/)
  })

  it('the card links to each class’s own insights on the member surface', async () => {
    const w = mount(NodeInsightsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(w.find('.cwl-card').attributes('href')).toBe('/org/q/insights')
  })
})
