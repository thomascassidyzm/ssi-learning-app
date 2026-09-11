/**
 * OrgIntelPanel — the three org questions render from one payload, in words
 * a head of department can act on, and never in a vendor's terms.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import OrgIntelPanel from './OrgIntelPanel.vue'
import type { OrgIntelPayload } from './data/orgIntel'

vi.mock('./InsightWidget.vue', () => ({
  default: { name: 'InsightWidget', props: ['spec', 'resolved'], template: '<div class="widget-stub" :data-kind="resolved.data.kind" />' },
}))

const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}

const DAY = 86400000
function payload(): OrgIntelPayload {
  return {
    node: { id: 'school-node', name: 'Ysgol Cas-gwent', kind: 'school' },
    windowDays: 7,
    lookbackDays: 28,
    countedAt: new Date().toISOString(),
    practising: { classCount: 34, classesThisWeek: 14, classesLastWeek: 1, phrasesThisWeek: 422, phrasesLastWeek: 3, peopleCount: 39, peopleThisWeek: 17, peopleLastWeek: 0, ownMinutesThisWeek: 124, ownMinutesLastWeek: 0 },
    byDay: Array.from({ length: 28 }, (_, i) => ({ day: new Date(Date.now() - (27 - i) * DAY).toISOString().slice(0, 10), phrases: i === 25 ? 329 : 0, classes: i === 25 ? 11 : 0 })),
    quiet: { quietCount: 1, neverCount: 13, buckets: [
      { id: 'this-week', classes: 20 }, { id: 'gone-a-week', classes: 0 }, { id: 'gone-two-weeks', classes: 0 },
      { id: 'gone-three-weeks', classes: 0 }, { id: 'gone-a-month', classes: 1 }, { id: 'never', classes: 13 },
    ] },
    journey: {
      courses: [{ code: 'cym_s_for_eng', sentences: 334 }],
      stages: [
        // 21 started + 13 never started = 34: started MEANS practised (api/org/intel.ts).
        { id: 'started', sentence: null, label: null, classes: 21 },
        { id: 'sentence-2', sentence: 2, label: { legoId: 'S0002L01', sentence: 2, knownText: 'to learn', targetText: 'dysgu' }, classes: 19 },
        { id: 'sentence-3', sentence: 3, label: { legoId: 'S0003L01', sentence: 3, knownText: 'I’m going to', targetText: 'dw i’n mynd i' }, classes: 16 },
        { id: 'sentence-5', sentence: 5, label: { legoId: 'S0005L01', sentence: 5, knownText: 'to practice speaking', targetText: 'ymarfer siarad' }, classes: 5 },
        { id: 'sentence-8', sentence: 8, label: { legoId: 'S0008L01', sentence: 8, knownText: 'I still want', targetText: 'dw i dal yn moyn' }, classes: 5 },
        { id: 'sentence-13', sentence: 13, label: { legoId: 'S0013L01', sentence: 13, knownText: 'yet', targetText: 'eto' }, classes: 0 },
      ],
    },
    classes: [
      { id: 'c-7h', name: '7H', courseCode: 'cym_s_for_eng', phrasesThisWeek: 52, phrasesLastWeek: 0, lastPractisedAt: new Date(Date.now() - DAY).toISOString(), daysSincePractice: 1, position: { legoId: 'S0003L01', sentence: 3, knownText: 'I’m going to', targetText: 'dw i’n mynd i' } },
      { id: 'c-6s', name: '6S', courseCode: 'cym_s_for_eng', phrasesThisWeek: 0, phrasesLastWeek: 0, lastPractisedAt: new Date(Date.now() - 55 * DAY).toISOString(), daysSincePractice: 55, position: { legoId: 'S0003L01', sentence: 3, knownText: 'I’m going to', targetText: 'dw i’n mynd i' } },
      { id: 'c-11e', name: '11E', courseCode: 'cym_s_for_eng', phrasesThisWeek: 0, phrasesLastWeek: 0, lastPractisedAt: null, daysSincePractice: null, position: null },
    ],
    people: [
      { learnerId: 'l-1', name: 'Mr Lloyd', minutesThisWeek: 31, minutesLastWeek: 0, lastPractisedDay: '2026-09-09' },
      { learnerId: 'l-2', name: 'Ms Rhys', minutesThisWeek: 0, minutesLastWeek: 0, lastPractisedDay: null },
    ],
  }
}

function mountPanel(p: OrgIntelPayload | null, extra: Partial<{ isLoading: boolean; error: string | null; member: boolean }> = {}) {
  return mount(OrgIntelPanel, {
    props: { payload: p, isLoading: false, error: null, member: true, ...extra },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('OrgIntelPanel', () => {
  it('answers the three questions in words, from the one payload', () => {
    const w = mountPanel(payload())
    const text = w.text()
    expect(text).toContain('14 of your 34 classes practised together this week, up from 1 last week, 422 phrases spoken.')
    expect(text).toContain('17 of 39 people practised on their own account, 124 minutes between them.')
    expect(text).toContain('1 class has gone quiet, and 13 have never started.')
    expect(text).toContain('21 of 34 classes have started.')
    expect(text).toContain('The furthest 5 have reached I still want · dw i dal yn moyn, sentence 8 of 334.')
    // The drop-off place: the biggest fall, earliest on a tie — 16 reached
    // the third sentence, 5 reached the fifth, so 11 stopped before it.
    expect(text).toContain('Most stop before to practice speaking · ymarfer siarad, sentence 5 of 334: 11 classes got to the step before it and no further.')
  })

  it('uses one widget per question — line, bars, funnel — and links each class to its own node', () => {
    const w = mountPanel(payload())
    expect(w.findAll('.widget-stub').map((el) => el.attributes('data-kind'))).toEqual(['time-series', 'ranked-bar', 'funnel'])
    expect(w.find('a[href="/org/c-7h"]').exists()).toBe(true)
    // Admin mount links into the admin class page instead.
    expect(mountPanel(payload(), { member: false }).find('a[href="/admin/classes/c-7h"]').exists()).toBe(true)
  })

  it('shows position as the phrase last played, never a bare seed id, and says whole-class time is not measured', () => {
    const w = mountPanel(payload())
    expect(w.text()).toContain('I’m going to · dw i’n mynd i')
    expect(w.text()).not.toMatch(/S00\d\dL\d\d/)
    expect(w.text()).toContain('No record measures how long a whole class practised together')
  })

  it('carries no vendor figure', () => {
    const text = mountPanel(payload()).text().toLowerCase()
    for (const word of ['paying', 'gifted', 'trial', 'conversion', 'subscription', 'ltv', 'other school']) {
      expect(text, word).not.toContain(word)
    }
  })

  it('states a 403 or a lapsed coverage in words rather than hiding the section', () => {
    const w = mountPanel(null, { error: 'You do not have access to this level’s practice.' })
    expect(w.text()).toContain('You do not have access to this level’s practice.')
    expect(w.findAll('.widget-stub')).toHaveLength(3)
  })
})
