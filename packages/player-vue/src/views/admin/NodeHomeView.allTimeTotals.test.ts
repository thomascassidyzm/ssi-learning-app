/**
 * THE OVERVIEW LEADS WITH ALL-TIME TOTALS (Tom, 2026-09-17): "i'm not sure I
 * like the default on the class overview being this week - it kind of gives
 * too much lumpiness to classes that might not do any Welsh from Monday to
 * Wednesday, then do quite a lot on Thursday and Friday / I think the weeks
 * are good units, but I prefer the default to be All Time Totals".
 *
 * So this file pins BOTH halves of that ruling, on a class and on a school:
 * the leading tiles carry the totals, and the week is still on the page as a
 * sentence beneath them. It is not a pin on "no week anywhere" — losing the
 * week would break the ruling just as surely as leading with it did.
 *
 * Both figures are the SAME rule (api/_utils/inAppTime.ts, and the target2
 * phrase): job #673's "one minute definition, one aggregation, everywhere"
 * is untouched — only the window opened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import NodeHomeView from './NodeHomeView.vue'
import { clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'

const routeMock = reactive({ params: { id: 'class-1' } as Record<string, any>, query: {} as Record<string, any> })
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}
const mountView = () => mount(NodeHomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })
const setupFetch = (payload: any) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })))

const NOW = new Date().toISOString()

function classPayload() {
  return {
    kind: 'class',
    node: { id: 'class-1', name: 'Year 7 Welsh', label: 'class', is_demo: false, rollup: { childGroupCount: 0, teacherCount: 2, classCount: 1, learnerCount: 2 }, commercial: null },
    ancestors: [{ id: 'school-node', name: 'Chepstow School', label: 'school', hasSchool: true }],
    siblings: [], children: [], teachers: [], students: [],
    journey: { done: 238, total: 320, source: 'class-play', legoId: 'S0060L02', seedNumber: 60 },
    benchmark: { class: 90, school: 30, course: 24 },
    practiceHours: 3,
    schoolId: 'school-1',
    nodeId: 'school-node',
    classPractice: {
      windowDays: 7,
      phrasesAllTime: 1315,
      inAppMinutesAllTime: 640,
      phrases7d: 42,
      inAppMinutes7d: 78,
      lastPractisedAt: NOW,
      phrases: [{ known: 'I want', target: 'dw i eisiau', count: 9 }],
    },
  }
}

function schoolPayload() {
  return {
    kind: 'node',
    node: { id: 'school-node', name: 'Chepstow School', label: 'school', is_demo: false, hasSchool: true, rollup: { childGroupCount: 0, teacherCount: 9, classCount: 34, learnerCount: 73 }, commercial: null },
    ancestors: [], siblings: [], children: [],
    practiceHours: 40,
    tree: { nodes: [], classes: [], staff: [] },
    classPractice: {
      windowDays: 7,
      classCount: 34,
      phrasesAllTime: 1315,
      activeClassesEver: 21,
      inAppMinutesAllTime: 640,
      phrases7d: 42,
      activeClasses7d: 3,
      inAppMinutes7d: 78,
      classInAppMinutesAllTime: 500,
      classInAppMinutes7d: 60,
      audioPlayedMinutes7d: 25,
      topPhrases7d: [{ known: 'I want', target: 'dw i eisiau', count: 9 }],
    },
  }
}

beforeEach(() => {
  clearNodeHomeCache()
  vi.unstubAllGlobals()
  routeMock.query = {}
  ;(routeMock as any).path = undefined
})

describe('the Overview leads with all-time totals, and keeps the week', () => {
  it('a class: the leading tiles are the totals, and the week is the sentence under the practice card', async () => {
    routeMock.params = { id: 'class-1' }
    setupFetch(classPayload())
    const wrapper = mountView()
    await flushPromises()

    const words = wrapper.findAll('.stat-card .stat-word').map((w) => w.text())
    const values = wrapper.findAll('.stat-card .stat-value').map((v) => v.text())
    expect(words.slice(0, 2)).toEqual(['Phrases practised in total', 'Minutes played as class in total'])
    expect(values.slice(0, 2)).toEqual(['1315', '640'])

    const text = wrapper.text()
    expect(text).toMatch(/1315\s*phrases practised in total/)
    expect(text).toContain('640 minutes in the app together altogether')
    // The week is not gone — it is the line beneath.
    expect(text).toContain('In the last seven days: 42 phrases and 78 minutes.')
  })

  it('a school: the leading tiles are the totals and classes that have ever practised, with the week beneath the row', async () => {
    routeMock.params = { id: 'school-node' }
    setupFetch(schoolPayload())
    const wrapper = mountView()
    await flushPromises()

    const words = wrapper.findAll('.stat-card .stat-word').map((w) => w.text())
    const values = wrapper.findAll('.stat-card .stat-value').map((v) => v.text())
    expect(words.slice(0, 3)).toEqual(['Phrases practised in total', 'Classes that have practised', 'Minutes in the app in total'])
    expect(values.slice(0, 3)).toEqual(['1315', '21/34', '640'])

    const text = wrapper.text()
    expect(text).toContain('totals for all the time your school has been learning')
    expect(text).toContain('In the last seven days: 42 phrases practised, 3 classes practising and 78 minutes in the app')
    // No tile says "this week" any more — that was the complaint.
    expect(words.some((w) => /this week/i.test(w))).toBe(false)
  })
})
