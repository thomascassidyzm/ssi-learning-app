/**
 * GROUPED ROWS, then Show all (Option A, job #306, 2026-09-12).
 *
 * St Alban's ledger was fourteen rows, twelve of them identical but for the
 * class name. The folded form is one row per role — "12 class links, none
 * used yet · 1 teacher link, used twice · 1 school leader link, none used
 * yet" — with Copy on a single-link row, and Show all opening the ledger
 * exactly as it was. Three links or fewer render whole (the class-scope and
 * dialect tests beside this one rely on that, unchanged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WaysInLedger from './WaysInLedger.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const BASE = {
  species: 'shareable' as const, personalName: null, status: 'active' as const,
  createdAt: '2026-09-08T09:00:00.000Z', createdBy: 'leejames',
}
const ST_ALBANS = [
  ...Array.from({ length: 12 }, (_, i) => ({
    ...BASE, role: 'student' as const, code: `CLS-${i}`, url: `https://x/join/CLS-${i}`,
    where: { nodeId: 'school-node', classId: `class-${i}`, name: `Class ${i} — St Albans`, kind: 'class' as const },
    uses: { count: 0, max: null, kind: 'redemption' as const, lastAt: null },
  })),
  {
    ...BASE, role: 'teacher' as const, code: 'TCH-1', url: 'https://x/join/TCH-1',
    where: { nodeId: 'school-node', classId: null, name: 'St Albans', kind: 'school' as const },
    uses: { count: 2, max: null, kind: 'redemption' as const, lastAt: null },
  },
  {
    ...BASE, role: 'school_leader' as const, code: 'LDR-1', url: 'https://x/join/LDR-1',
    where: { nodeId: 'school-node', classId: null, name: 'St Albans', kind: 'school' as const },
    uses: { count: 0, max: null, kind: 'redemption' as const, lastAt: null },
  },
]

describe('WaysInLedger — grouped rows, then Show all', () => {
  let copied: string[] = []
  beforeEach(() => {
    copied = []
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ links: ST_ALBANS }) })) as unknown as typeof fetch)
    vi.stubGlobal('navigator', { clipboard: { writeText: async (v: string) => { copied.push(v) } } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function mountLedger() {
    const w = mount(WaysInLedger, { props: { nodeId: 'school-node' } })
    await flushPromises(); await flushPromises()
    return w
  }

  it('fourteen links fold to one row per role, with counts and uses in words', async () => {
    const w = await mountLedger()
    const rows = w.findAll('.ways-in-group').map((r) => [r.find('.group-word').text(), r.find('.group-uses').text(), r.find('button').exists() ? r.find('button').text() : ''])
    expect(rows).toEqual([
      ['12 class links', 'none used yet', ''],
      ['1 teacher link', 'used 2 times', 'Copy'],
      ['1 school leader link', 'none used yet', 'Copy'],
    ])
    // The ledger table and its chips are folded away, but named.
    expect(w.findAll('tbody tr')).toHaveLength(0)
    expect(w.findAll('.chip')).toHaveLength(0)
    expect(w.find('[data-walk="ways-in-show-all"]').text()).toContain('Show all 14 links')
    // Revoke lives only in the open ledger.
    expect(w.text()).not.toContain('Revoke')
  })

  it('Copy on a single-link row copies that link without opening the ledger', async () => {
    const w = await mountLedger()
    const teacherRow = w.findAll('.ways-in-group')[1]
    await teacherRow.find('button.row-verb').trigger('click')
    await flushPromises()
    expect(copied).toEqual(['https://x/join/TCH-1'])
    expect(w.findAll('tbody tr')).toHaveLength(0)
  })

  it('Show all opens the ledger exactly as it was — chips, every row, Revoke — and Show fewer folds it back', async () => {
    const w = await mountLedger()
    await w.find('[data-walk="ways-in-show-all"]').trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(14)
    expect(w.findAll('.chip').length).toBeGreaterThan(0)
    expect(w.findAll('[data-walk="ways-in-revoke"]')).toHaveLength(14)
    const fewer = w.find('.show-all[data-show-all="fewer"]')
    expect(fewer.text()).toContain('Show fewer')
    await fewer.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(0)
    expect(w.findAll('.ways-in-group')).toHaveLength(3)
  })

  it('three links or fewer render the ledger whole, with no fold and no control', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ links: ST_ALBANS.slice(11) }) })) as unknown as typeof fetch)
    const w = await mountLedger()
    expect(w.findAll('tbody tr')).toHaveLength(3)
    expect(w.findAll('.ways-in-group')).toHaveLength(0)
    expect(w.find('.show-all').exists()).toBe(false)
  })
})
