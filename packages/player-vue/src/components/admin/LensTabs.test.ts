/**
 * Job #628 — Tom's three rulings of 2026-09-14 on the node pages:
 *  1. on Insights the graph tool (NodeRateEngine) comes BEFORE the org
 *     questions block;
 *  2. Overview | Insights are tabs on both pages, the open one selected;
 *  3. the Where-you-are rail names which of the two is open.
 * Each pin failed on the pre-#628 code and passes after it.
 *
 * Job #674 (Tom, 14:42Z the same day): "It's not THAT clear that we're in
 * Overview OR Insights / I think it should only show one of these" — the rail
 * line now names ONLY the open view, capitalised, and is not a control; the
 * LensTabs pair is the switch. The rail pins below failed on the #628 code
 * (which rendered "insights · overview" as a button) and pass after #674.
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
  it('names only the open view beneath you-are-here — the other view is absent', () => {
    const w = mount(NodeMapRail, {
      props: { ...base, lens: { current: 'insights', overviewPath: '/org/cls', insightsPath: '/org/cls/insights' } },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    const line = w.find('.rail-lens')
    expect(line.exists()).toBe(true)
    expect(line.text()).toBe('Insights')
    expect(line.text().toLowerCase()).not.toContain('overview')
    expect(line.find('.rail-lens-other').exists()).toBe(false)
    // Plain text, not a control: nothing to tap, nothing navigates.
    expect(line.element.tagName).not.toBe('BUTTON')
    expect(w.find('.rail-lens button').exists()).toBe(false)
    // Straight after the you're-here row, not anywhere else in the list.
    const rows = w.findAll('.rail-row')
    const hereIdx = rows.findIndex((r) => r.classes().includes('is-here'))
    expect(rows[hereIdx + 1].classes()).toContain('is-lens')
  })
  it('says Overview, and only Overview, on the node home', () => {
    const w = mount(NodeMapRail, {
      props: { ...base, lens: { current: 'overview', overviewPath: '/org/cls', insightsPath: '/org/cls/insights' } },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    expect(w.find('.rail-lens').text()).toBe('Overview')
    expect(w.find('.rail-lens').text().toLowerCase()).not.toContain('insights')
  })
  it('draws no lens line when the node has no insights page', () => {
    const w = mount(NodeMapRail, { props: { ...base }, global: { stubs: { RouterLink: RouterLinkStub } } })
    expect(w.find('.rail-lens').exists()).toBe(false)
  })
})
