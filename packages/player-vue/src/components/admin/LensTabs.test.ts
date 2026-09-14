/**
 * Job #628 — Tom's three rulings of 2026-09-14 on the node pages:
 *  1. on Insights the graph tool (NodeRateEngine) comes BEFORE the org
 *     questions block;
 *  2. Overview | Insights are tabs on both pages, the open one selected;
 *  3. the Where-you-are rail names which of the two is open, tappable to switch.
 * Each pin failed on the pre-#628 code and passes after it.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import LensTabs from './LensTabs.vue'
import NodeMapRail from './NodeMapRail.vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/org/school-1', query: {} }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}))

const here = dirname(fileURLToPath(import.meta.url))
const RouterLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }

describe('graph tool leads the Insights page', () => {
  it('renders NodeRateEngine above the org-questions section in NodeInsightsView', () => {
    const src = readFileSync(join(here, '../../views/admin/NodeInsightsView.vue'), 'utf8')
    const tpl = src.slice(src.indexOf('<template>'))
    const engine = tpl.indexOf('<NodeRateEngine')
    const questions = tpl.indexOf('class="org-intel-section"')
    expect(engine).toBeGreaterThan(-1)
    expect(questions).toBeGreaterThan(-1)
    expect(engine).toBeLessThan(questions)
  })
  it('both node pages mount the same LensTabs pair', () => {
    for (const f of ['NodeHomeView.vue', 'NodeInsightsView.vue']) {
      const src = readFileSync(join(here, `../../views/admin/${f}`), 'utf8')
      expect(src, f).toContain('<LensTabs')
    }
  })
})

describe('LensTabs', () => {
  it('shows Overview and Insights side by side with the open one selected', () => {
    const w = mount(LensTabs, {
      props: { overviewPath: '/org/school-1', insightsPath: '/org/school-1/insights', current: 'insights' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    const tabs = w.findAll('[data-lens-tab]')
    expect(tabs.map((x) => x.text())).toEqual(['Overview', 'Insights'])
    expect(tabs[1].classes()).toContain('active')
    expect(tabs[0].classes()).not.toContain('active')
    expect(tabs[0].attributes('href')).toBe('/org/school-1')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
  })
})

describe('NodeMapRail lens line', () => {
  const base = {
    ancestors: [{ id: 'sch', name: 'Ysgol Cas-gwent Chepstow', label: 'school' }],
    node: { id: 'cls', name: '10E', label: 'class' },
    siblings: [], children: [], kind: 'class' as const,
  }
  it('says which page is open beneath you-are-here and switches on tap', async () => {
    const w = mount(NodeMapRail, {
      props: { ...base, lens: { current: 'insights', overviewPath: '/org/cls', insightsPath: '/org/cls/insights' } },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    const line = w.find('.rail-lens')
    expect(line.exists()).toBe(true)
    expect(line.find('.rail-lens-current').text()).toBe('insights')
    expect(line.find('.rail-lens-other').text()).toContain('overview')
    // Straight after the you're-here row, not anywhere else in the list.
    const rows = w.findAll('.rail-row')
    const hereIdx = rows.findIndex((r) => r.classes().includes('is-here'))
    expect(rows[hereIdx + 1].classes()).toContain('is-lens')
    await line.trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/org/cls')
  })
  it('draws no lens line when the node has no insights page', () => {
    const w = mount(NodeMapRail, { props: { ...base }, global: { stubs: { RouterLink: RouterLinkStub } } })
    expect(w.find('.rail-lens').exists()).toBe(false)
  })
})
