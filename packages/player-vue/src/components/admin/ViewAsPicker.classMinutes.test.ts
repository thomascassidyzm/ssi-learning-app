/**
 * ViewAsPicker — candidates carry their classes' minutes this week and sort
 * most-active first (Tom, 2026-09-14 16:20Z, job #683). Red on the old
 * picker, which showed names with no numbers and picked by last_active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const viewAs = vi.fn(async () => {})
vi.mock('@/composables/useViewAs', () => ({ useViewAs: () => ({ viewAs, viewAsError: { value: null } }) }))
vi.mock('@/composables/useUserRole', () => ({ useUserRole: () => ({ canViewAs: { value: true } }) }))
vi.mock('@/composables/useAdminClient', () => ({ useAdminClient: () => ({ getAuthToken: async () => 'tok' }) }))

const USERS = [
  { id: 'l1', user_id: 'williams', display_name: 'Mr Williams', educational_role: 'teacher', last_active: '2026-09-14T15:00:00Z', class_minutes_7d: 0, school_name: 'Monmouth' },
  { id: 'l2', user_id: 'angharad', display_name: 'angharadjones', educational_role: 'school_admin', last_active: '2026-09-10T09:00:00Z', class_minutes_7d: 272, school_name: 'Chepstow' },
]
let calls: string[] = []

beforeEach(() => {
  calls = []
  viewAs.mockClear()
  globalThis.fetch = vi.fn(async (url: any) => { calls.push(String(url)); return { ok: true, json: async () => ({ users: USERS }) } }) as any
})

describe('ViewAsPicker — real numbers beside every name, busiest first', () => {
  it('search results show role · school · minutes this week, most active first', async () => {
    const { default: ViewAsPicker } = await import('./ViewAsPicker.vue')
    const w = mount(ViewAsPicker)
    await w.find('[data-testid="view-as-open"]').trigger('click')
    await w.find('[data-testid="view-as-search"]').setValue('an')
    await new Promise((r) => setTimeout(r, 300))
    await flushPromises()
    expect(calls[0]).toContain('class_minutes_7d=1')
    const items = w.findAll('[data-testid="view-as-result"]')
    expect(items.length).toBe(2)
    expect(items[0].text()).toContain('angharadjones')
    expect(items[0].text()).toContain('School leader · Chepstow · 4 h 32 min this week')
    expect(items[1].text()).toContain('Teacher · Monmouth · 0 min this week')
  })

  it('the Teacher shortcut asks the server for the busiest and lands on the one with the most class minutes', async () => {
    const { default: ViewAsPicker } = await import('./ViewAsPicker.vue')
    globalThis.fetch = vi.fn(async (url: any) => { calls.push(String(url)); return { ok: true, json: async () => ({ users: USERS.map((u) => ({ ...u, educational_role: 'teacher' })) }) } }) as any
    const w = mount(ViewAsPicker)
    await w.find('[data-testid="view-as-open"]').trigger('click')
    await w.find('[data-testid="view-as-role-teacher"]').trigger('click')
    await flushPromises()
    expect(calls[0]).toContain('role=teacher')
    expect(calls[0]).toContain('sort=class_minutes_7d')
    expect(viewAs).toHaveBeenCalledWith(expect.objectContaining({ userId: 'angharad' }))
  })
})
