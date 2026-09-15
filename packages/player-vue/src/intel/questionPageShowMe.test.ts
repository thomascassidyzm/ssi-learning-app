/**
 * The Handbook's Show-me door on the intelligence surface (job #878).
 *
 * Intel walks compile into the pack and pass the coverage gate, but a walk
 * nobody can tap is unreachable: WalkOffer is what offers it, by persona ×
 * place, and before this it was mounted on the node pages only. The layout
 * owns it here so no question page can forget.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import QuestionPage from './QuestionPage.vue'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ byQuestion: {}, silent: false, generatedAt: null, ageHours: null }) })))
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/intel/pulse', query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

const walksFor = vi.fn((persona: string, place: string) =>
  persona === 'admin' && place === 'intel'
    ? [{ id: 'reading-a-question-page', title: 'Reading a question page', personas: ['admin'], place: { route: 'intel' }, steps: [] }]
    : [])
vi.mock('@/walkthrough/useWalkthrough', () => ({
  walksFor: (...a: [string, string, string?]) => walksFor(...a),
  startWalk: vi.fn(),
  claimDeferredWalk: vi.fn(),
}))

describe('the Show-me door on a question page', () => {
  it('offers the intel walks to the admin reading the page', () => {
    const w = mount(QuestionPage, {
      props: { question: 'q', answer: 'a', fetchedAt: null, people: 1 },
      global: { stubs: { 'router-link': { props: ['to'], template: '<a><slot /></a>' } } },
    })
    const offer = w.find('[data-walk-offer="reading-a-question-page"]')
    expect(offer.exists()).toBe(true)
    expect(offer.text()).toContain('Show me')
    expect(walksFor).toHaveBeenCalledWith('admin', 'intel', undefined)
  })
})
