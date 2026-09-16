/**
 * WalkOffer — the page's own Show-me list (job #5, 2026-09-16).
 *
 * Tom: "Show me can be a list of clips that are relevant to each page — the
 * handbook is the compendium of everything." The Teachers page carried five
 * of these by hand; this proves the same five now come out of the compiled
 * pack, and that a page with more than a handful folds behind one chip.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WalkOffer from './WalkOffer.vue'

// localiseWalk reads `t` directly, so the mock carries both shapes. Defined
// inside the factory: vi.mock is hoisted above every const in this file.
vi.mock('@/composables/useI18n', () => {
  const t = (_k: string, fb: string) => fb
  return { useI18n: () => ({ t }), t }
})

/** Mount standing on a route, the way the router's global $route reads. */
function onRoute(path: string, props: Record<string, unknown>) {
  return mount(WalkOffer, {
    props,
    global: { config: { globalProperties: { $route: { matched: [{ path }] } } } },
  })
}

describe('the per-page Show-me list', () => {
  it('REGRESSION: the Teachers page offers exactly the five links it carried by hand', () => {
    const w = onRoute('/schools/teachers', { persona: 'school_admin', place: 'teachers' })
    const ids = w.findAll('[data-walk-offer]').map((b) => b.attributes('data-walk-offer'))
    expect([...ids].sort()).toEqual([
      'add-teacher-by-name',
      'hand-a-teacher-access-code',
      'invite-a-teacher-to-your-school',
      'remove-a-teacher',
      'take-a-teacher-off-a-class',
    ])
    expect(w.find('[data-walk-offer-list]').exists(), 'five is not more than a handful').toBe(false)
  })

  it('offers a teacher only their own, on the same page', () => {
    const w = onRoute('/schools/teachers', { persona: 'teacher', place: 'teachers' })
    const ids = w.findAll('[data-walk-offer]').map((b) => b.attributes('data-walk-offer'))
    expect(ids).toEqual(['take-a-teacher-off-a-class'])
  })

  it('folds behind one chip when the page carries more than a handful', () => {
    // The node home is the busiest page in the dashboard for a leader.
    const w = onRoute('/org/:id', { persona: 'leader', place: 'node-home' })
    const chip = w.find('[data-walk-offer-list]')
    expect(chip.exists()).toBe(true)
    expect(w.findAll('[data-walk-offer]')).toHaveLength(0)
    expect(chip.text()).toMatch(/Show me — \d+/)
  })

  it('renders nothing where no clip and no walk stands', () => {
    const w = onRoute('/nowhere', { persona: 'teacher', place: 'not-a-place' })
    expect(w.find('.walk-offer').exists()).toBe(false)
  })
})
