/**
 * CLASS MODE (2026-09-07). The ledger answers on a SUBTREE — a class page
 * mounts it on the class's school node, so without a filter a leader standing
 * on 7B would see every link in the whole school. `classId` narrows it to the
 * links minted for that class, keyed on `where.classId` (the server's
 * `where.nodeId` for a class row is its SCHOOL's node, so it cannot do this).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WaysInLedger from './WaysInLedger.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const LINKS = [
  {
    role: 'student', species: 'personal', personalName: 'Megan', code: 'AAA-111',
    url: 'https://x/redeem/AAA-111', where: { nodeId: 'school-node-1', classId: 'class-7b', name: '7B — Ysgol', kind: 'class' },
    uses: { count: 0, max: null, kind: 'signin', lastAt: null }, status: 'active',
    createdAt: '2026-09-06T10:00:00Z', createdBy: 'A Leader',
  },
  {
    role: 'student', species: 'personal', personalName: 'Rhys', code: 'BBB-222',
    url: 'https://x/redeem/BBB-222', where: { nodeId: 'school-node-1', classId: 'class-8a', name: '8A — Ysgol', kind: 'class' },
    uses: { count: 0, max: null, kind: 'signin', lastAt: null }, status: 'active',
    createdAt: '2026-09-06T10:00:00Z', createdBy: 'A Leader',
  },
  {
    role: 'teacher', species: 'shareable', personalName: null, code: 'CCC-333',
    url: 'https://x/redeem/CCC-333', where: { nodeId: 'school-node-1', classId: null, name: 'Ysgol', kind: 'school' },
    uses: { count: 1, max: null, kind: 'redemption', lastAt: null }, status: 'active',
    createdAt: '2026-09-06T10:00:00Z', createdBy: 'A Leader',
  },
]

describe('WaysInLedger — class scope', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ links: LINKS }) })) as unknown as typeof fetch)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function mountAt(props: Record<string, unknown>) {
    const w = mount(WaysInLedger, { props: props as any })
    await flushPromises(); await flushPromises()
    return w
  }

  it('shows only this class\'s links, and says so when there are none', async () => {
    const w = await mountAt({ nodeId: 'school-node-1', classId: 'class-7b' })
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Megan')
    expect(w.text()).toContain('1 link')

    const empty = await mountAt({ nodeId: 'school-node-1', classId: 'class-9z' })
    expect(empty.findAll('tbody tr')).toHaveLength(0)
    expect(empty.text()).toContain('No links for this class yet')
  })

  it('without classId the school ledger still shows everything', async () => {
    const w = await mountAt({ nodeId: 'school-node-1' })
    expect(w.findAll('tbody tr')).toHaveLength(3)
  })
})
