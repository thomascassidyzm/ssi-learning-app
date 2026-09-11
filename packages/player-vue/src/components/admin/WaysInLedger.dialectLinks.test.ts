/**
 * The per-dialect sign-up link, in the ledger — job #615.
 *
 * The Canolfan's free year covers North AND South Welsh under one policy and
 * one link, so a learner following it is asked which dialect they want. Kai's
 * cohorts already know: a North Wales tutor's whole room wants North Welsh.
 * So the leader can copy a link per course, straight from the row they
 * already use, and that link never asks.
 *
 * What is pinned here: the buttons exist and are named after the courses, the
 * link they copy is the SAME code with the course on it, and no ordinary link
 * grows a button it should not have.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WaysInLedger from './WaysInLedger.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const BASE = {
  where: { nodeId: 'g1', name: 'Dysgu Cymraeg', kind: 'group' as const },
  status: 'active' as const,
  createdAt: '2026-09-08T09:00:00.000Z',
  createdBy: 'Kai',
  species: 'shareable' as const,
  role: 'student' as const,
  uses: { count: 40, max: null, kind: 'redemption' as const, lastAt: null },
}

describe('WaysInLedger — one link per dialect', () => {
  let links: unknown[] = []
  let copied: string[] = []

  beforeEach(() => {
    copied = []
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ links }) })) as unknown as typeof fetch)
    vi.stubGlobal('navigator', { clipboard: { writeText: async (v: string) => { copied.push(v) } } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function mountLedger() {
    const wrapper = mount(WaysInLedger, { props: { nodeId: 'g1' } })
    await flushPromises()
    await flushPromises()
    return wrapper
  }

  function courseButtons(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('[data-walk="ways-in-copy-course"]')
  }

  it('offers a copy verb per granted course, named in words a leader reads', async () => {
    links = [{ ...BASE, code: 'CYM-001', url: 'https://saysomethingin.app/enrol/CYM-001', enrolmentCourses: ['cym_n_for_eng', 'cym_s_for_eng'] }]
    const wrapper = await mountLedger()
    const buttons = courseButtons(wrapper)
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.text())).toEqual(['Copy Welsh (North)', 'Copy Welsh (South)'])
  })

  it('copies the same code with the course on it — one link, one cohort', async () => {
    links = [{ ...BASE, code: 'CYM-001', url: 'https://saysomethingin.app/enrol/CYM-001', enrolmentCourses: ['cym_n_for_eng', 'cym_s_for_eng'] }]
    const wrapper = await mountLedger()
    await courseButtons(wrapper)[0].trigger('click')
    await flushPromises()
    expect(copied).toEqual(['https://saysomethingin.app/enrol/CYM-001?course=cym_n_for_eng'])
  })

  it('an ordinary link grows no course buttons, and neither does a one-course cohort', async () => {
    links = [
      { ...BASE, code: 'PLAIN', url: 'https://saysomethingin.app/redeem/PLAIN' },
      { ...BASE, code: 'ONE', url: 'https://saysomethingin.app/enrol/ONE', enrolmentCourses: ['cym_n_for_eng'] },
    ]
    const wrapper = await mountLedger()
    expect(courseButtons(wrapper)).toHaveLength(0)
  })

  it('a revoked link offers nothing to copy', async () => {
    links = [{ ...BASE, status: 'revoked', code: 'CYM-001', url: 'https://saysomethingin.app/enrol/CYM-001', enrolmentCourses: ['cym_n_for_eng', 'cym_s_for_eng'] }]
    const wrapper = await mountLedger()
    expect(courseButtons(wrapper)).toHaveLength(0)
  })
})
