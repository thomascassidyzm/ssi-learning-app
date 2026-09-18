/**
 * NodeRateEngine in WEEK MODE — the settled shape (Tom, 2026-09-16): one
 * toggle, one compare-to picker, the card. No course picker for a class, no
 * measure picker, no definitional paragraph, no rank anywhere. Tags are
 * confirmed in place through PATCH /api/classes/:id/tags.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeRateEngine from './NodeRateEngine.vue'

vi.mock('@/composables/useDashboardRefresh', () => ({
  useDashboardRefresh: () => ({ refresh: async () => {}, registerRefresh: () => {} }),
}))

function weekBody(overrides: Record<string, any> = {}) {
  return {
    node: { id: 'c1', name: 'Grade 6A', label: 'class', kind: 'class' },
    options: {
      courses: [{ code: 'eng_for_hin', classCount: 3 }],
      compares: [
        { value: 'tag:year', label: 'Year 6 average', word: 'year' },
        { value: 's1-node', label: 'Sunrise Public School average', word: 'school' },
        { value: 'global', label: 'Global average · this course', word: 'global' },
      ],
      windows: [{ value: 'this_week', label: 'This week' }, { value: 'last_week', label: 'Last week' }],
      measures: [],
    },
    applied: { course_code: 'eng_for_hin', compare_to: 'tag:year', days: 7, window: 'this_week', measure: 'rate' },
    kFloor: 1,
    insufficientData: false,
    metricLabel: 'Rate of progress', unit: 'phrases', per: 'week',
    entity: { label: 'Grade 6A', value: 10, trend: [1, 2] },
    average: { label: 'Year 6 average', value: 6, trend: [1, 1] },
    deltaPct: 66.7,
    percentile: 100,
    distribution: { values: [4, 8], min: 4, q1: 5, median: 6, q3: 7, max: 8, entityValue: 10, averageValue: 6, percentile: 100 },
    cohortSize: 2,
    cohortUnit: 'classes',
    week: {
      window: 'this_week', label: 'This week', rangeLabel: '14–20 Sep',
      entity: { label: 'Grade 6A', classMinutes: 30, pupilMinutes: 5, totalMinutes: 35, newPhrases: 6, hasData: true },
      cohort: { label: 'Year 6 average', classMinutes: 20, pupilMinutes: 2, totalMinutes: 22, newPhrases: 4, size: 2, sizeLabel: '2 classes' },
      bars: { weeks: ['a', 'b'], entity: [10, 35], cohort: [8, 22] },
    },
    allTime: { started: true, sinceLabel: '3 Feb 2026', classMinutes: 600, pupilMinutes: 0, totalMinutes: 600, phrasesReached: 90 },
    tags: { year: { value: '6', confirmed: true, derived: '6' }, department: { value: 'English', confirmed: false, derived: 'English' } },
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: any) => {
    if (String(url).includes('/tags')) {
      return { ok: true, json: async () => ({ ok: true, tags: { year: { value: '6', confirmed: true, derived: '6' }, department: { value: 'English', confirmed: true, derived: 'English' } } }) }
    }
    return { ok: true, json: async () => weekBody() }
  })
  vi.stubGlobal('fetch', fetchMock)
})

const mountEngine = (props: Record<string, any> = {}) =>
  mount(NodeRateEngine, { props: { nodeId: 'c1', getToken: async () => 'tok', plainWords: true, ...props } })

describe('NodeRateEngine — week mode', () => {
  it('the card leads: one week toggle, one compare-to; no course picker, no measure picker, no definitional paragraph', async () => {
    const w = mountEngine()
    await flushPromises()
    expect(w.find('[data-walk="insights-window"]').exists()).toBe(true)
    expect(w.find('[data-walk="insights-compare"]').exists()).toBe(true)
    expect(w.find('[data-walk="insights-measure"]').exists()).toBe(false)
    expect(w.find('.nre-metric-desc').exists()).toBe(false)
    expect(w.find('.nre-controls').exists()).toBe(false)
    expect(w.text()).not.toMatch(/Course|Measure/)
    expect(w.find('[data-walk="insights-rate-widget"]').exists()).toBe(true)
  })

  it('no rank anywhere — the server’s percentile is never drawn', async () => {
    const w = mountEngine()
    await flushPromises()
    expect(w.text()).not.toMatch(/percentile|100th|1st of/i)
  })

  it('the compare picker offers the year rung in a teacher’s words, and the school as "School average"', async () => {
    const w = mountEngine()
    await flushPromises()
    const opts = (w.findComponent({ name: 'FrostSelect' }).props('options') as { label: string }[]).map((o) => o.label)
    expect(opts).toEqual(['Year 6 average', 'School average', 'Everyone on this course'])
  })

  it('shows all-time totals and the tag line for a class; confirming a tag PATCHes and re-reads', async () => {
    const w = mountEngine()
    await flushPromises()
    expect(w.text()).toContain('Since 3 Feb 2026 · 10h practised · 90 phrases reached')
    const line = w.find('[data-walk="insights-class-tags"]')
    expect(line.text()).toContain('Year 6')
    expect(line.text()).toContain('English department')
    expect(line.text()).toContain('guessed from the course')
    await line.find('.ct-link-confirm').trigger('click')
    await flushPromises()
    const patch = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/classes/c1/tags'))
    expect(patch).toBeTruthy()
    expect(patch![1].method).toBe('PATCH')
    expect(JSON.parse(patch![1].body)).toEqual({ department: 'English' })
    // re-read after the save so a newly-confirmed year can open its rung
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('rate-compare')).length).toBe(2)
  })

  it('a school keeps a course picker only when it runs more than one course; a class never', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => weekBody({
      node: { id: 's1', name: 'Sunrise', label: 'school', kind: 'node' },
      options: { ...weekBody().options, courses: [{ code: 'eng_for_hin', classCount: 3 }, { code: 'eng_for_mar', classCount: 1 }] },
      tags: null, allTime: null,
    }) }))
    const w = mountEngine({ nodeId: 's1' })
    await flushPromises()
    expect(w.text()).toContain('Course')
    expect(w.find('[data-walk="insights-class-tags"]').exists()).toBe(false)
  })

  it('week mode never ALSO renders the legacy rate widget — no "+53%", no "1st of 3" under the card, at class or school level', async () => {
    for (const nodeOverrides of [{}, { node: { id: 's1', name: 'Sunrise', label: 'school', kind: 'node' }, tags: null, allTime: null }]) {
      fetchMock.mockImplementation(async () => ({ ok: true, json: async () => weekBody(nodeOverrides) }))
      const w = mountEngine({ nodeId: (nodeOverrides as any).node?.id ?? 'c1' })
      await flushPromises()
      expect(w.findComponent({ name: 'RateCompare' }).exists()).toBe(false)
      expect(w.text()).not.toMatch(/%|1st of|Rate of progress/)
    }
  })
})
