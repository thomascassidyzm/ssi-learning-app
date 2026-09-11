/**
 * InsightWidget × Funnel — the wrapper's widget contract is { data, annotations }
 * and nothing else. Funnel.vue declared `spec` required and read `spec.annotate`
 * blind, so the first school whose classes had started the course took its
 * admin's whole /org/:id/insights page into the error boundary with
 * "TypeError: Cannot read properties of undefined (reading 'annotate')"
 * (job #259, staging, 2026-09-11). This mounts the real wrapper and the real
 * widget, exactly as OrgIntelPanel's journey question does, and fails on the
 * pre-fix Funnel.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import InsightWidget from './InsightWidget.vue'
import type { AnyInsightSpec, ResolvedInsight } from './spec'

// happy-dom has no canvas; the chart itself is not under test.
vi.mock('echarts', () => ({
  registerTheme: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
  graphic: { LinearGradient: class {} },
}))

const spec: AnyInsightSpec = {
  widget: 'funnel',
  query: { metric: 'orgJourney', window: 'all' },
  frame: 'world',
  title: 'Classes reaching each point in the course',
  tag: 'classes',
}
const resolved: ResolvedInsight = {
  isLoading: false,
  error: null,
  data: {
    kind: 'funnel',
    stages: [
      { id: 'started', label: 'started', value: 21 },
      { id: 'sentence-2', label: 'to learn · sentence 2 of 334', value: 19 },
      { id: 'sentence-5', label: 'to practice speaking · sentence 5 of 334', value: 5 },
    ],
  },
}

describe('InsightWidget renders the funnel widget from the wrapper contract alone', () => {
  it('mounts the journey funnel for a school node without a spec prop on the widget', async () => {
    const errors: unknown[] = []
    ;(globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} }
    const wrapper = mount(InsightWidget, {
      props: { spec, resolved },
      global: { config: { errorHandler: (e) => errors.push(e) } },
    })
    // defineAsyncComponent resolves the glob loader on a later tick than flushPromises covers.
    for (let i = 0; i < 20 && !wrapper.find('.funnel-widget').exists() && errors.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25))
      await flushPromises()
    }
    expect(errors).toEqual([])
    expect(wrapper.find('.funnel-widget').exists()).toBe(true)
    expect(wrapper.find('.fig-state.is-error').exists()).toBe(false)
  })
})
