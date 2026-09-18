/**
 * NodeRateEngine on ALL TIME — the window the schools Insights page opens on
 * since Tom's ruling of 2026-09-17 ("it must ALSO offer All time, and All time
 * is the DEFAULT"), under his of 2026-09-16 that all time is TOTALS ONLY:
 * no second column, no average line, and therefore no Compare-to picker.
 * The two school weeks stay selectable in the same chip row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeRateEngine from './NodeRateEngine.vue'

vi.mock('@/composables/useDashboardRefresh', () => ({
  useDashboardRefresh: () => ({ refresh: async () => {}, registerRefresh: () => {} }),
}))

const allTimeBody = () => ({
  node: { id: 'school-1', name: 'Chepstow School', label: 'school', kind: 'group' },
  options: {
    courses: [{ code: 'cym_s_for_eng', classCount: 34 }],
    compares: [{ value: 'global', label: 'Global average · this course', word: 'global' }],
    windows: [
      { value: 'all_time', label: 'All time' },
      { value: 'this_week', label: 'This week' },
      { value: 'last_week', label: 'Last week' },
    ],
    measures: [],
  },
  applied: { course_code: 'cym_s_for_eng', compare_to: 'global', days: 1500, window: 'all_time', measure: 'rate' },
  kFloor: 1,
  totalsOnly: true,
  levelNoun: 'school',
  week: {
    window: 'all_time', label: 'All time', rangeLabel: 'Since 20 Apr 2026',
    entity: { label: 'Chepstow School', classMinutes: 640, pupilMinutes: 0, totalMinutes: 640, newPhrases: 1315, hasData: true },
    cohort: null,
    bars: { weeks: ['a', 'b'], entity: [10, 35], cohort: [null, null] },
  },
  allTime: null,
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => allTimeBody() })))
})

const mountEngine = () =>
  mount(NodeRateEngine, { props: { nodeId: 'school-1', getToken: async () => 'tok', plainWords: true } })

describe('NodeRateEngine — all time', () => {
  it('draws the card, with all three windows to switch between', async () => {
    const w = await mountEngine()
    await flushPromises()
    expect(w.find('[data-walk="insights-rate-widget"]').exists()).toBe(true)
    expect(w.find('[data-walk="insights-window"]').exists()).toBe(true)
    expect(w.text()).toContain('All time')
    expect(w.text()).toContain('This week')
    expect(w.text()).toContain('Last week')
  })

  it('shows the totals and the date it started, and no comparison of any kind', async () => {
    const w = await mountEngine()
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Since 20 Apr 2026')
    expect(text).toContain('10h 40m')
    expect(text).toContain('1315')
    expect(text).toContain('Phrases reached')
    // Totals only: no Compare-to picker, no second column, no average, no rank.
    expect(w.find('[data-walk="insights-compare"]').exists()).toBe(false)
    expect(text).not.toMatch(/average/i)
    expect(text).not.toMatch(/percentile|1st of/i)
  })
})
