/**
 * Tests for NodeRateEngine.vue — THE LENS's one engine component. Pins:
 * one round trip fills pickers + widget; the server-resolved defaults are
 * reflected back up (deep links stay honest); plainWords mode speaks
 * teacher language (design law §1.12 — never "entity"/"cohort", the school
 * ancestor becomes "School average"); honest states for insufficient data
 * and expired sessions; and the refresh protocol (loader registered, no
 * polling).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeRateEngine from './NodeRateEngine.vue'

vi.mock('./components/RateCompare.vue', () => ({
  default: { name: 'RateCompare', props: ['data'], template: '<div class="rate-compare-stub">{{ data.entity.label }} v {{ data.average.label }}</div>' },
}))

const registered: Array<() => void | Promise<void>> = []
vi.mock('@/composables/useDashboardRefresh', () => ({
  useDashboardRefresh: () => ({
    refresh: async () => { await registered[registered.length - 1]?.() },
    registerRefresh: (fn: () => void | Promise<void>) => { registered.push(fn) },
  }),
}))

function apiBody(overrides: Record<string, any> = {}) {
  return {
    node: { id: 'c1', name: 'Year 6 Hindi', label: 'class', kind: 'class' },
    options: {
      courses: [{ code: 'hin_for_eng', classCount: 2 }, { code: 'tam_for_eng', classCount: 1 }],
      compares: [
        { value: 's1-node', label: 'Sunrise Public School average', word: 'school' },
        { value: 'programme', label: 'IME Demo Programme average', word: 'programme' },
        { value: 'global', label: 'Global average · this course', word: 'global' },
        { value: 'global_all_courses', label: 'Global average · all courses', word: 'global' },
      ],
    },
    applied: { course_code: 'hin_for_eng', compare_to: 's1-node', days: 90 },
    kFloor: 1,
    insufficientData: false,
    metricLabel: 'Rate of progress',
    unit: 'LEGOs',
    per: 'week',
    entity: { label: 'Year 6 Hindi', value: 10, trend: [1, 2] },
    average: { label: 'Sunrise Public School average', value: 6, trend: [1, 1] },
    deltaPct: 66.7,
    percentile: 100,
    distribution: { values: [4, 8], min: 4, q1: 5, median: 6, q3: 7, max: 8, entityValue: 10, averageValue: 6, percentile: 100 },
    cohortSize: 2,
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function mountEngine(props: Record<string, any> = {}) {
  return mount(NodeRateEngine, {
    props: {
      nodeId: 'c1',
      getToken: async () => 'tok',
      ...props,
    },
  })
}

beforeEach(() => {
  registered.length = 0
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => apiBody() }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('NodeRateEngine', () => {
  it('one round trip: fetches the node comparison and renders pickers + widget', async () => {
    const wrapper = mountEngine()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/groups/c1/rate-compare')
    expect(wrapper.find('.rate-compare-stub').text()).toContain('Year 6 Hindi')
    // course picker present (2 courses below the node)
    expect(wrapper.text()).toContain('hin_for_eng')
    // compare picker carries the ancestor chain labels
    expect(wrapper.text()).toContain('Sunrise Public School average')
  })

  it('reflects server-resolved defaults up for the deep link', async () => {
    const wrapper = mountEngine()
    await flushPromises()
    expect(wrapper.emitted('update:course')?.[0]).toEqual(['hin_for_eng'])
    expect(wrapper.emitted('update:compare')?.[0]).toEqual(['s1-node'])
    expect(wrapper.emitted('state')?.[0]?.[0]).toMatchObject({ node: { id: 'c1' } })
  })

  it('passes explicit course/compare through as query params', async () => {
    mountEngine({ course: 'tam_for_eng', compare: 'programme' })
    await flushPromises()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('course_code=tam_for_eng')
    expect(url).toContain('compare_to=programme')
  })

  it('plainWords: teacher language, never engine vocabulary', async () => {
    const wrapper = mountEngine({ plainWords: true })
    await flushPromises()
    // The compare picker's options all speak plain words (the closed
    // FrostSelect only paints the selection, so assert on its options).
    const compareSelect = wrapper.findAllComponents({ name: 'FrostSelect' }).at(-1)!
    const labels = (compareSelect.props('options') as { label: string }[]).map((o) => o.label)
    expect(labels).toEqual([
      'School average',
      'IME Demo Programme average',
      'Everyone on this course',
      'All SSi learners · all courses',
    ])
    // the copy pin: no engine vocabulary anywhere in teacher-facing copy
    const everything = `${wrapper.text()} ${labels.join(' ')}`.toLowerCase()
    expect(everything).not.toContain('entity')
    expect(everything).not.toContain('cohort')
    expect(everything).not.toContain('node')
  })

  it('honest insufficient-data state instead of a fabricated number', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => apiBody({ insufficientData: true, reason: 'Not enough data to compare fairly yet.' }),
    })
    const wrapper = mountEngine()
    await flushPromises()
    expect(wrapper.find('.rate-compare-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('Not enough data to compare fairly yet.')
    // pickers still render so the user can widen the comparison
    expect(wrapper.text()).toContain('Compare to')
  })

  it('expired session reads as a re-login prompt, not an empty class', async () => {
    const wrapper = mountEngine({ getToken: async () => null })
    await flushPromises()
    expect(wrapper.text()).toContain('sign in again')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('registers exactly one refresh loader and never polls', async () => {
    mountEngine()
    await flushPromises()
    expect(registered.length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
