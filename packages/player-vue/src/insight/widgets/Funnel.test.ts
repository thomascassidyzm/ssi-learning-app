import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Funnel from './Funnel.vue'
import type { FunnelData, Annotation } from '../spec'

// Regression test for the "Cannot read properties of undefined (reading
// 'annotate')" TypeError on the admin /admin/stats Lifecycle funnel: the
// wrapper (InsightWidget.vue) only ever passes { data, annotations } to a
// widget (Stat.vue is the reference contract) — Funnel.vue used to also
// declare a required `spec` prop and read `props.spec.annotate`, which the
// wrapper never supplied, so `spec` was always undefined at render time.

vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  registerTheme: vi.fn(),
}))

const data: FunnelData = {
  kind: 'funnel',
  stages: [
    { id: 'signed_up', label: 'Signed up', value: 100 },
    { id: 'activated', label: 'Activated', value: 60 },
    { id: 'engaged', label: 'Engaged', value: 30 },
    { id: 'paid', label: 'Paid', value: 5 },
  ],
}

const annotations: Annotation[] = [
  { at: 'stage', stage: 'activated', note: 'Biggest drop — the leak to fix first.', tone: 'alarm' },
]

describe('Funnel widget', () => {
  it('renders with only { data, annotations } — the real wrapper contract — without throwing', async () => {
    const wrapper = mount(Funnel, { props: { data, annotations } })
    await flushPromises()
    expect(wrapper.find('.funnel-widget').exists()).toBe(true)
  })

  it('renders the stage annotation callout', async () => {
    const wrapper = mount(Funnel, { props: { data, annotations } })
    await flushPromises()
    expect(wrapper.text()).toContain('Biggest drop — the leak to fix first.')
  })

  it('renders with no annotations at all (annotations prop omitted, using its default)', async () => {
    const wrapper = mount(Funnel, { props: { data } })
    await flushPromises()
    expect(wrapper.find('.funnel-widget').exists()).toBe(true)
    expect(wrapper.find('.funnel-annotations').exists()).toBe(false)
  })
})
