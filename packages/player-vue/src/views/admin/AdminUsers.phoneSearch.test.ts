/**
 * Users page search at phone width (Tom, 2026-09-15: "search for users is
 * broken on MOBILE but works fine on desktop"). Measured live on an iPhone 14
 * viewport: the filters card fills the first screen, the first result row
 * starts at y=661 of 664, and nothing on screen changes as you type. So the
 * search must answer right under the box, and the phone's Search key must
 * dismiss the keyboard and bring the rows up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }) }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/composables/useDashboardRefresh', () => ({
  useDashboardRefresh: () => {
    let handler: (() => Promise<void>) | null = null
    return {
      registerRefresh: (fn: () => Promise<void>) => { handler = fn },
      refresh: async () => { await handler?.() },
      isRefreshing: { value: false }, lastUpdated: { value: null }, updatedLabel: { value: '' }, hasHandler: { value: true }, markUpdated: () => {},
    }
  },
}))
vi.mock('@/components/shared/UpdatedStamp.vue', () => ({ default: { template: '<span />' } }))

function user(id: string, name: string, email: string) {
  return { id, user_id: id, display_name: name, primary_email: email, emails: [email], created_at: '2026-09-01T00:00:00Z', educational_role: null, platform_role: null, needs_verification: false, tier: 'free', last_active: null, practice_minutes: 0, practice_minutes_estimated: false, course_ids: [] }
}
const USERS = [user('a', 'Tom Cassidy', 'tom@example.com'), user('b', 'Angharad Jones', 'aj@example.com'), user('c', 'Bethan Cassidy', 'bc@example.com')]

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: USERS }) })) as any
})

describe('AdminUsers — search on a phone', () => {
  it('says what it found right under the box, and the Search key drops the keyboard and scrolls to the rows', async () => {
    const { default: AdminUsers } = await import('./AdminUsers.vue')
    const w = mount(AdminUsers, { attachTo: document.body })
    await flushPromises()
    expect(w.findAll('tbody tr').length).toBe(3)
    expect(w.find('[data-testid="users-search-summary"]').exists()).toBe(false)

    const input = w.find('[data-testid="users-search"]')
    // iOS: the Search key on the keyboard, no autocorrect mangling a name or email.
    expect(input.attributes('enterkeyhint')).toBe('search')
    expect(input.attributes('autocorrect')).toBe('off')
    expect(input.attributes('autocapitalize')).toBe('off')

    await input.setValue('cassidy')
    await nextTick()
    expect(w.findAll('tbody tr').length).toBe(2)
    expect(w.find('[data-testid="users-search-summary"]').text()).toBe('2 users match')

    const scrolled = vi.fn()
    ;(w.find('.list-panel').element as HTMLElement).scrollIntoView = scrolled
    ;(input.element as HTMLInputElement).focus()
    expect(document.activeElement).toBe(input.element)
    await input.trigger('keydown', { key: 'Enter' })
    expect(scrolled).toHaveBeenCalled()
    expect(document.activeElement).not.toBe(input.element)

    await input.setValue('angharad')
    await nextTick()
    expect(w.find('[data-testid="users-search-summary"]').text()).toBe('1 user matches')
    w.unmount()
  })
})
