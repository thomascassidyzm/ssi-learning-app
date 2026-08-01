/**
 * Tests for NodeHomeView.vue — THE VIEW's one recursive node home
 * (docs/THE-VIEW.md). Pins the founder ruling: the SAME page grammar at
 * every level (org root / mid group / school / class) — map rail with
 * you-are-here, identity header, stats row, children list — plus the two
 * navigation rules: lenses are filters over the one view (query-driven,
 * never separate pages) and clicking any node name lands on that node's
 * home.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import NodeHomeView from './NodeHomeView.vue'
import { clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { setSchoolsClient } from '@/composables/schools/client'

const routeMock = reactive({ params: { id: 'programme' } as Record<string, any>, query: {} as Record<string, any> })
const pushMock = vi.fn()
const replaceMock = vi.fn((to: any) => { routeMock.query = to.query || {} })

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}))

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const ROLLUP = { childGroupCount: 1, teacherCount: 2, classCount: 1, learnerCount: 80 }

function nodePayload(overrides: Record<string, any> = {}) {
  return {
    kind: 'node',
    node: { id: 'programme', name: 'IME Demo Programme', label: 'programme', is_demo: true, hasSchool: false, rollup: ROLLUP, commercial: null },
    ancestors: [{ id: 'nation', name: 'India', label: 'nation', hasSchool: false }],
    siblings: [{ id: 'programme-2', name: 'Other Programme', label: 'programme', hasSchool: false }],
    children: [
      { id: 'school-node', name: 'Sunrise Public School', label: 'school', hasSchool: true, is_demo: true, rollup: { childGroupCount: 0, teacherCount: 3, classCount: 4, learnerCount: 42 }, commercial: { schoolId: 'school-1', platformStatus: 'trial', trialCourseCode: 'hin_for_eng' } },
    ],
    practiceHours: 266.4,
    ...overrides,
  }
}

function classPayload() {
  return {
    kind: 'class',
    node: { id: 'class-1', name: 'Year 6 Hindi', label: 'class', is_demo: true, rollup: { childGroupCount: 0, teacherCount: 2, classCount: 1, learnerCount: 2 }, commercial: null },
    ancestors: [
      { id: 'nation', name: 'India', label: 'nation', hasSchool: false },
      { id: 'school-node', name: 'Sunrise Public School', label: 'school', hasSchool: true },
    ],
    siblings: [],
    children: [],
    teachers: [
      { user_id: 't1', name: 'Ms Mehta', is_lead: true },
      { user_id: 't2', name: 'Mr Rao', is_lead: false },
    ],
    students: [
      { learner_id: 'l1', name: 'Asha', seeds_completed: 25, legos_mastered: 60, practice_hours: 2, last_active_at: new Date().toISOString(), last7_minutes: [0, 10, 5, 0, 20, 15, 10], week_minutes: 60 },
      { learner_id: 'l2', name: 'Ravi', seeds_completed: 5, legos_mastered: 12, practice_hours: 1, last_active_at: null, last7_minutes: [0, 0, 0, 0, 0, 0, 0], week_minutes: 0 },
    ],
    journey: { done: 60, total: 320 },
    benchmark: { class: 90, school: 30, course: 24 },
    practiceHours: 3,
    schoolId: 'school-1',
    nodeId: 'school-node',
  }
}

// vue-router is mocked at module level, so <router-link> isn't registered —
// stub it as a plain anchor carrying its `to` as href.
const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}

function mountView() {
  return mount(NodeHomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

let fetchMock: ReturnType<typeof vi.fn>
let lastPayload: any

function setupFetch(payload: any) {
  lastPayload = payload
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => lastPayload }))
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  clearNodeHomeCache()
  vi.unstubAllGlobals()
  pushMock.mockClear()
  replaceMock.mockClear()
  routeMock.params = { id: 'programme' }
  routeMock.query = {}
  ;(routeMock as any).path = undefined
})

describe('NodeHomeView — one grammar at every level', () => {
  it('group level: map rail (ancestors, you-are-here, siblings, children), identity, stats, children rows', async () => {
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    // Map rail: ancestor, you-are-here, sibling toggle, child
    expect(text).toContain('India')
    expect(text).toContain("you're here")
    expect(text).toContain('1 other at this level')
    // Identity header
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
    expect(text).toContain('Demo')
    // Stats row — subtree totals + hours
    expect(text).toContain('80')
    expect(text).toContain('266.4h')
    // Children list — school child with the same row grammar
    expect(wrapper.find('.child-name').text()).toBe('Sunrise Public School')
    // Lens chips present (filters over the one view)
    expect(text).toContain('All schools')
    expect(text).toContain('All teachers')
  })

  it('org-root level: renders with no ancestors and no siblings', async () => {
    setupFetch(nodePayload({ ancestors: [], siblings: [] }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
    expect(wrapper.text()).toContain("you're here")
    expect(wrapper.text()).not.toContain('at this level')
  })

  it('school level: same page, trial state named in the header', async () => {
    routeMock.params = { id: 'school-1' }
    setupFetch(nodePayload({
      node: { id: 'school-node', name: 'Sunrise Public School', label: 'school', is_demo: false, hasSchool: true, rollup: ROLLUP, commercial: { schoolId: 'school-1', platformStatus: 'trial', trialCourseCode: 'hin_for_eng' } },
      children: [],
    }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.identity-text .schools-kicker').text()).toBe('School')
    expect(wrapper.text()).toContain('Trial — hin_for_eng')
    // Analytics verb targets the school's deep tools
    expect(wrapper.find('a[href="/admin/schools/school-1/analytics"]').exists()).toBe(true)
  })

  it('class level: same grammar — rail to the school, read-only teachers (lead first), students as children', async () => {
    routeMock.params = { id: 'class-1' }
    setupFetch(classPayload())
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    expect(wrapper.find('.identity-name').text()).toBe('Year 6 Hindi')
    expect(text).toContain('Sunrise Public School') // rail ancestor
    expect(text).toContain('Ms Mehta')
    expect(text).toContain('(lead)')
    expect(text).toContain('Mr Rao')
    // Students rendered in the same child-row grammar
    const names = wrapper.findAll('.child-name').map((n) => n.text())
    expect(names).toEqual(['Asha', 'Ravi'])
    // No lens chips at class level
    expect(text).not.toContain('All schools')
  })

  it('lens chips are filters over the one view: chip → query update → lens payload rendered', async () => {
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    setupFetch(nodePayload({
      schools: [
        { schoolId: 'school-1', nodeId: 'school-node', name: 'Sunrise Public School', teacherCount: 3, classCount: 4, studentCount: 42, practiceHours: 135.1, hasAdmin: true, teachers: ['Ms Mehta', 'Mr Rao'] },
        { schoolId: 'school-2', nodeId: 'school-node-2', name: 'St Mary\'s Academy', teacherCount: 3, classCount: 2, studentCount: 38, practiceHours: 131.3, hasAdmin: false, teachers: [] },
      ],
    }))
    const chips = wrapper.findAll('.chip')
    await chips.find((c) => c.text() === 'All schools')!.trigger('click')
    await flushPromises()

    expect(replaceMock).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('lens=schools'), expect.anything())
    const names = wrapper.findAll('.child-name').map((n) => n.text())
    expect(names).toEqual(['Sunrise Public School', "St Mary's Academy"])
    expect(wrapper.text()).toContain('Awaiting admin')
  })

  it('NAVIGATION PIN: clicking a child name goes to that node\'s home; rail ancestors do too', async () => {
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.child-btn').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/admin/groups/school-node')

    await wrapper.find('.rail-link').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/admin/groups/nation')
  })

  it('TEACHING-DATA PIN: class home shows per-student belts + the class cards (journey, belt distribution, benchmark)', async () => {
    routeMock.params = { id: 'class-1' }
    setupFetch(classPayload())
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    // Per-student belt derived from seeds (25 → orange, 5 → white) + LEGOs count
    expect(text).toContain('orange')
    expect(text).toContain('white')
    expect(text).toContain('60')
    expect(wrapper.findAll('.belt-dot').length).toBeGreaterThan(0)
    // Class cards
    expect(text).toContain('Course journey')
    expect(text).toContain('Belt distribution')
    expect(text).toContain('Practice min/student/week')
    // Journey note speaks LEGOs (position-is-LEGO ruling: never "seed")
    expect(text).toContain('LEGOs mastered on average')
    expect(text).not.toMatch(/\bseed\b/i)
  })

  it('CLASS-PRACTICE PIN: class home LEADS with the class practising together — practice card first, journey + belt from class play, students below as the bonus layer', async () => {
    routeMock.params = { id: 'class-1' }
    const payload = classPayload()
    ;(payload as any).classPractice = { weekSessions: 2, sessions28d: 2, totalSessions: 3, lastSessionAt: new Date().toISOString(), hours: 1.3 }
    payload.journey = { done: 238, total: 320, source: 'class-play', legoId: 'S0060L02', seedNumber: 60 } as any
    setupFetch(payload)
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    // Stats row leads with class practice, not individual hours.
    expect(text).toContain('Class sessions this week')
    expect(text).toContain('1.3h')
    // The Class practice card renders FIRST among the class cards.
    const cards = wrapper.findAll('.class-card .schools-kicker').map((k) => k.text())
    expect(cards[0]).toBe('Class practice')
    expect(text).toContain('sessions this week')
    expect(text).toContain('Last class session')
    // Journey rides the CLASS's own play-as-class position (LEGO units).
    expect(text).toContain('The class has travelled 238 of 320 LEGOs together')
    // Belt comes from the class's play position (seed 60 → green → Blue next).
    expect(text).toContain('Blue belt')
    // Students remain below, in the same flat row grammar (the bonus layer).
    expect(wrapper.findAll('.child-name').map((n) => n.text())).toEqual(['Asha', 'Ravi'])
    // Never the word "seed" user-facing (position-is-LEGO ruling).
    expect(text).not.toMatch(/\bseed\b/i)
  })

  it('a class with NO class practice yet: teaching invitation copy, journey falls back to the students\' average', async () => {
    routeMock.params = { id: 'class-1' }
    const payload = classPayload()
    ;(payload as any).classPractice = { weekSessions: 0, sessions28d: 0, totalSessions: 0, lastSessionAt: null, hours: 0 }
    payload.journey = { done: 60, total: 320, source: 'estimate', legoId: null, seedNumber: null } as any
    setupFetch(payload)
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('No class practice yet')
    // Fallback journey rendering: students' average LEGOs drives the bar.
    expect(text).toContain('LEGOs mastered on average')
  })

  it('LEARNER-PAGE-DEAD PIN: student rows are FLAT — everything in-row, no click, no navigation, no streak', async () => {
    routeMock.params = { id: 'class-1' }
    setupFetch(classPayload())
    const wrapper = mountView()
    await flushPromises()

    // All the teaching data is on the row itself (founder ruling 2026-07-19):
    // journey position, last-7-days minutes — no expansion panel exists.
    const row = wrapper.find('.child-row.is-flat')
    expect(row.exists()).toBe(true)
    expect(row.find('.child-journey').exists()).toBe(true)
    expect(row.text()).toContain('60 of 320 LEGOs')
    expect(row.find('.child-spark').exists()).toBe(true)
    expect(row.text()).toContain('60m this wk')
    // Streaks are banned (founder ruling 2026-07-19,
    // docs/gamification-done-right.md) — the word never renders.
    expect(wrapper.text().toLowerCase()).not.toContain('streak')
    // Clicking does nothing: no navigation, no expansion.
    await row.find('.child-btn').trigger('click')
    expect(pushMock).not.toHaveBeenCalled()
    expect(wrapper.find('.child-detail').exists()).toBe(false)
  })
  it('RAIL-STABILITY PIN (founder 2026-07-30): remounting with the node cached — the hop back from Insights — paints the full page synchronously, no loading screen, no rail flash', async () => {
    setupFetch(nodePayload())
    const first = mountView()
    await flushPromises()
    first.unmount()

    // The hop back: the fresh fetch is still in flight — the cached payload
    // must carry the whole first paint, rail included.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const wrapper = mountView()
    await Promise.resolve()

    expect(wrapper.find('.loading-spinner').exists()).toBe(false)
    expect(wrapper.find('.rail-skel').exists()).toBe(false)
    expect(wrapper.text()).toContain('Where you are')
    expect(wrapper.text()).toContain("you're here")
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
    // Stats render the still-correct cached values (same node, seconds old).
    expect(wrapper.text()).toContain('266.4h')
  })

  it('MEMBER-MOUNT PIN (/schools/org/:id): same page for a leader — links stay in member scope, no admin escape, invite verbs only', async () => {
    ;(routeMock as any).path = '/schools/org/programme'
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    // Same grammar renders (rail, identity, stats, children)
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
    expect(wrapper.text()).toContain("you're here")
    // Rail rooted at the leader's scope: no "All organisations" admin escape
    expect(wrapper.text()).not.toContain('All organisations')
    // Navigation stays inside /schools/org — child row and rail ancestor
    await wrapper.find('.child-btn').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/schools/org/school-node')
    await wrapper.find('.rail-link').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/schools/org/nation')
    // See insights points at the member lens, not /admin
    expect(wrapper.find('a[href="/schools/org/programme/insights"]').exists()).toBe(true)
    // Verbs: leaders keep the invite pair; structural admin verbs are hidden
    const verbs = wrapper.findAll('.verb').map((v) => v.text())
    expect(verbs).toContain('Invite a person')
    expect(verbs).toContain('Get a shareable link')
    expect(verbs).not.toContain('Add a group')
    expect(verbs).not.toContain('Mint a demo org')
    expect(verbs).not.toContain('Rename')
    expect(verbs).not.toContain('Delete')
    expect(verbs).not.toContain('Courses')
  })
})

// Org platform trial/upgrade (founder-specced 2026-08-01, group-leader lane).
// Routes fetch by URL — unlike setupFetch above — because these specs need
// BOTH /api/groups/:id/home (the node payload) and /api/org/subscription (the
// gate) answered differently in the same test.
function setupRoutedFetch(homePayload: any, orgResponse: any) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/org/subscription')) {
      return { ok: true, json: async () => orgResponse }
    }
    return { ok: true, json: async () => homePayload }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('NodeHomeView — org platform trial/upgrade (member surface, govt_admin)', () => {
  const ctx = useSchoolContext()

  beforeEach(() => {
    ctx.currentUser.value = null
    // The expired wall embeds UpgradeView, whose org/school/tutor lanes all
    // touch schools composables that resolve a client at setup — mirrors the
    // idiom other schools *.test.ts files use to mount without a real session.
    setSchoolsClient({
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    } as any)
  })

  it('mid-trial: shows the days-remaining banner with an always-visible Upgrade link, dashboard still renders', async () => {
    ;(routeMock as any).path = '/schools/org/programme'
    ctx.currentUser.value = {
      user_id: 'leader-1', learner_id: 'l1', display_name: 'Leader',
      educational_role: 'govt_admin', platform_role: null, group_id: 'programme',
    }
    setupRoutedFetch(nodePayload(), { org: { id: 'programme', platform_status: 'trial', seats: null, member_count: 3 }, gate: { active: true, trial_days_remaining: 12 } })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('12 days left in your organisation\'s free trial')
    expect(wrapper.find('a[href="/schools/upgrade"]').exists()).toBe(true)
    // Dashboard renders normally underneath the banner — trial is not a wall.
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
  })

  it('expired: the whole node home is replaced by the pay-in-app wall, never a dead end', async () => {
    ;(routeMock as any).path = '/schools/org/programme'
    ctx.currentUser.value = {
      user_id: 'leader-1', learner_id: 'l1', display_name: 'Leader',
      educational_role: 'govt_admin', platform_role: null, group_id: 'programme',
    }
    setupRoutedFetch(nodePayload(), { org: { id: 'programme', platform_status: 'expired', seats: 5, member_count: 8 }, gate: { active: false, trial_days_remaining: 0 } })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain("Your organisation's free trial has ended")
    // The underlying node dashboard is gone — no dead end, no identity header.
    expect(wrapper.find('.identity-name').exists()).toBe(false)
  })

  it('paid (active, no trial): no banner, no wall — the dashboard renders plainly', async () => {
    ;(routeMock as any).path = '/schools/org/programme'
    ctx.currentUser.value = {
      user_id: 'leader-1', learner_id: 'l1', display_name: 'Leader',
      educational_role: 'govt_admin', platform_role: null, group_id: 'programme',
    }
    setupRoutedFetch(nodePayload(), { org: { id: 'programme', platform_status: 'active', seats: 5, member_count: 4 }, gate: { active: true, trial_days_remaining: 0 } })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).not.toContain('free trial')
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
  })

  it('admin mount (not a member/govt_admin view): never fetches the org gate, no banner', async () => {
    ;(routeMock as any).path = undefined // admin mount
    ctx.currentUser.value = null
    const fetchMock = setupRoutedFetch(nodePayload(), { org: null, gate: { active: false, trial_days_remaining: 0 } })
    const wrapper = mountView()
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/org/subscription'), expect.anything())
    expect(wrapper.text()).not.toContain('free trial')
  })
})
