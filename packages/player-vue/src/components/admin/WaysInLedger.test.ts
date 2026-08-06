import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WaysInLedger from './WaysInLedger.vue'

// 2026-08-06 field report: the ledger showed "USES 0 · ACTIVE" for a personal
// link whose recipient was demonstrably a member and had practised. The cause
// was structural, not a lost write — invite_codes.use_count is only ever
// incremented by /api/code/redeem, which the personal-link flow never calls
// (it signs straight in via /api/auth/possession-redeem). So the ledger was
// printing a number that could never be right. The server now sends the real
// sign-in tally from the possession_mint_attempts audit log, tagged
// kind:'signin'; these tests pin what the leader actually reads.
vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const BASE = {
  where: { nodeId: 'g1', name: 'Test Group', kind: 'group' as const },
  status: 'active' as const,
  createdAt: '2026-08-05T21:40:05.608Z',
  createdBy: 'A Leader',
}

function link(over: Record<string, unknown>) {
  return { ...BASE, ...over }
}

// The stubbed fetch below serves whatever `links` currently holds, so each
// test sets that first and then mounts.
async function mountLedger() {
  const wrapper = mount(WaysInLedger, { props: { nodeId: 'g1' } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

function usesCells(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('tbody td.num')
}

describe('WaysInLedger — the Uses column tells the truth for both link species', () => {
  let links: unknown[] = []

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ links }),
    })) as unknown as typeof fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a personal link its real sign-in count, never the frozen use_count', async () => {
    links = [link({
      role: 'student', species: 'personal', personalName: 'Test Person 1',
      code: 'MZU-172', url: 'https://x/redeem/MZU-172',
      uses: { count: 2, max: null, kind: 'signin', lastAt: '2026-08-06T10:01:57Z' },
    })]
    const wrapper = await mountLedger()
    const cell = usesCells(wrapper)[0]
    expect(cell.text()).toBe('2')
    expect(cell.attributes('title')).toContain('Test Person 1 has signed in with this link 2 times')
  })

  it('says "Not yet" — not a bare 0 — when the person has not opened their link', async () => {
    links = [link({
      role: 'student', species: 'personal', personalName: 'Test Person 1',
      code: 'ZZZ-000', url: 'https://x/redeem/ZZZ-000',
      uses: { count: 0, max: null, kind: 'signin', lastAt: null },
    })]
    const wrapper = await mountLedger()
    const cell = usesCells(wrapper)[0]
    // A bare "0" read as "this link is broken"; "Not yet" is the actual state.
    expect(cell.text()).toBe('Not yet')
    expect(cell.text()).not.toBe('0')
    expect(cell.classes()).toContain('is-not-yet')
    expect(cell.attributes('title')).toBe("Test Person 1 hasn't opened this link yet")
  })

  it('uses the singular for exactly one visit', async () => {
    links = [link({
      role: 'teacher', species: 'personal', personalName: 'Solo',
      code: 'ONE-001', url: 'https://x/redeem/ONE-001',
      uses: { count: 1, max: null, kind: 'signin', lastAt: '2026-08-06T10:01:57Z' },
    })]
    const wrapper = await mountLedger()
    expect(usesCells(wrapper)[0].attributes('title')).toContain('signed in with this link once')
  })

  it('leaves shareable codes on the familiar n / max, unchanged', async () => {
    links = [
      link({
        role: 'teacher', species: 'shareable', personalName: null,
        code: 'SRC-324', url: 'https://x/redeem/SRC-324',
        uses: { count: 4, max: null, kind: 'redemption', lastAt: null },
      }),
      link({
        role: 'leader', species: 'shareable', personalName: null,
        code: 'TST-TOM', url: 'https://x/redeem/TST-TOM',
        uses: { count: 5, max: 10, kind: 'redemption', lastAt: null },
      }),
    ]
    const wrapper = await mountLedger()
    const cells = usesCells(wrapper)
    expect(cells[0].text()).toBe('4')
    expect(cells[1].text()).toBe('5 / 10')
    // A shareable zero stays a zero — nobody has joined yet is a real count.
    expect(cells[0].classes()).not.toContain('is-not-yet')
    expect(cells[0].attributes('title')).toBe('4 people have joined with this link')
  })
})
