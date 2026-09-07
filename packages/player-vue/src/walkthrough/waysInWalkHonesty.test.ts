import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import WaysInLedger from '@/components/admin/WaysInLedger.vue'
import pack from './pack.json'
import type { Walk } from './useWalkthrough'

// 2026-09-07, minutes before a live college demo: a school leader ran the
// "Ways in" walk on a school whose ledger held ONLY shareable links, and was
// told about a **Re-mint** button that was nowhere on the page. Re-mint is
// real, but it is bound to a PERSONAL link (the server: "Only personal links
// can be re-minted; mint a fresh shareable link instead") — so on that page
// the guidance described an action the page gave no way to perform.
//
// The compiler's anchor gate cannot catch this: data-walk="ways-in-remint"
// does exist in the source, behind a v-if on link species. These tests pin
// the runtime truth the gate cannot see — the state the leader was actually
// in, and what the walk must say while they are in it.
vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getClient: () => ({}), getAuthToken: async () => 'test-token' }),
}))
vi.mock('@/composables/useOrgLeadership', () => ({
  useOrgLeadership: () => ({ leadsOrg: ref(true), ensureLoaded: async () => {} }),
}))

import NodeActionBar from '@/components/admin/NodeActionBar.vue'

const SHAREABLE_ONLY = ['student', 'teacher', 'school_leader'].map((role, i) => ({
  role,
  species: 'shareable' as const,
  personalName: null,
  code: `AAA-00${i}`,
  url: `https://x/join/AAA-00${i}`,
  uses: { count: 0, max: null, kind: 'redemption' as const, lastAt: null },
  where: { nodeId: 'g1', name: 'Neath College 001', kind: 'school' as const },
  status: 'active' as const,
  createdAt: '2026-09-07T12:00:00.000Z',
  createdBy: 'A Leader',
}))

const waysIn = (pack as { walks: Walk[] }).walks.find((w) => w.id === 'ways-in')!
const said = waysIn.steps.map((s) => `${s.say} ${s.terminal ?? ''}`).join('\n')

describe('the ways-in walk cannot promise a verb the page has no way to perform', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ links: SHAREABLE_ONLY }) })) as unknown as typeof fetch)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('the state that started this: a shareable-only ledger renders NO Re-mint button', async () => {
    const wrapper = mount(WaysInLedger, { props: { nodeId: 'g1' } })
    await flushPromises()
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.findAll('[data-walk="ways-in-remint"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Re-mint')
  })

  it('so the walk scopes Re-mint to a personal link, and says a shareable link has none', () => {
    expect(said).toMatch(/own sign-in link/i)
    expect(said).toMatch(/shareable link has no Re-mint/i)
  })

  it('and it points at where a NEW shareable link really is made — the verb bar, not the ledger', () => {
    const step = waysIn.steps.find((s) => /Get a shareable link/.test(s.say))
    expect(step, 'the walk must name the verb that actually mints a shareable link').toBeTruthy()
    // That verb must really be on the leader's own page, under the anchor the
    // walk rings — mounted as the member (leader) mount Tom was looking at.
    const bar = mount(NodeActionBar, {
      props: { node: { id: 'g1', name: 'Neath College 001', label: 'school' }, member: true },
      global: {
        provide: { auth: { user: ref({ id: 'u1', user_metadata: { has_password: true } }), updatePassword: vi.fn() } },
        stubs: { NodeEntitlementControl: true, ConfirmDeleteModal: true, ManagerOnboardingGate: true },
      },
    })
    const anchored = bar.find(`[data-walk="${step!.anchor}"]`)
    expect(anchored.exists(), `data-walk="${step!.anchor}" must be on the leader's action bar`).toBe(true)
    expect(anchored.text()).toBe('Get a shareable link')
  })
})
