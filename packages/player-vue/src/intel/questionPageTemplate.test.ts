/**
 * The template tests the design asks for.
 *
 * §3.1: "The rail, the Updated stamp and the population chip appear on every
 * page, the same component in the same slot. A page without them fails a
 * template test." And: "Pages that have no verbs render the bar empty rather
 * than omitting it."
 *
 * These are structural rather than visual, so they are cheap and they hold
 * whatever a page later chooses to put in its slots.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import QuestionPage from './QuestionPage.vue'
import { QUESTIONS, questionPath } from './questions'

const routerStubs = {
  'router-link': { props: ['to'], template: '<a><slot /></a>' },
}

function mountPage(slots: Record<string, string> = {}) {
  return mount(QuestionPage, {
    props: {
      question: 'How many real people practised this week?',
      answer: '12 real people practised this week.',
      fetchedAt: new Date('2026-09-10T09:00:00Z'),
      people: 533,
    },
    slots,
    global: {
      stubs: routerStubs,
      mocks: { $route: { path: '/intel/pulse', query: {} } },
      provide: {},
    },
  })
}

// ScopeRail reaches for useRoute/useRouter, so the whole layout is mounted with
// vue-router's composables stubbed rather than a real router being spun up.
import { vi } from 'vitest'
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/intel/pulse', query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

describe('the five-part question page', () => {
  it('carries the rail, the answer, the stamp and the population chip', () => {
    const w = mountPage()
    expect(w.find('[data-intel="scope-rail"]').exists()).toBe(true)
    expect(w.find('[data-intel="answer"]').exists()).toBe(true)
    expect(w.find('[data-intel="updated-stamp"]').exists()).toBe(true)
    expect(w.find('[data-intel="population-chip"]').exists()).toBe(true)
  })

  it('renders the verb bar EMPTY rather than omitting it when a page has no verbs', () => {
    const w = mountPage()
    const bar = w.find('[data-intel="verb-bar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toBe('')
  })

  it('keeps the five parts in their fixed order', () => {
    const w = mountPage({ evidence: '<div>chart</div>', rows: '<div>rows</div>' })
    const order = [...w.element.querySelectorAll('[data-intel]')]
      .map((el) => el.getAttribute('data-intel'))
      .filter((n) => n && n !== 'updated-stamp' && n !== 'population-chip')
    expect(order).toEqual(['scope-rail', 'verb-bar', 'answer', 'evidence', 'rows'])
  })

  it('says the population is still being counted rather than showing a number it does not have', () => {
    const w = mount(QuestionPage, {
      props: { question: 'q', answer: null, fetchedAt: null, people: null },
      global: { stubs: routerStubs },
    })
    expect(w.find('[data-intel="population-chip"]').text()).toContain('Counting real people')
    expect(w.find('[data-intel="updated-stamp"]').text()).toContain('Updating')
  })
})

describe('the ten questions', () => {
  it('is exactly ten, numbered one to ten, with one route each', () => {
    expect(QUESTIONS).toHaveLength(10)
    expect(QUESTIONS.map((q) => q.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const paths = QUESTIONS.map(questionPath)
    expect(new Set(paths).size).toBe(10)
  })

  it('is one tap from anywhere in the surface — every question has its own path', () => {
    // The top bar renders every question as a direct link, so "one tap to any
    // answer" reduces to "every question has a path and the bar lists them all".
    for (const q of QUESTIONS) {
      expect(questionPath(q)).toBe(`/intel/${q.slug}`)
    }
  })
})
