/**
 * CLASS-SCOPED INVITE VERB (founder ruling 2026-09-07: "we need it to be easy
 * to see how to add students to a class — it's not super easy and there's no
 * obvious flow for it").
 *
 * A leader standing on ONE class could previously only go up to the whole
 * school and mint a school-wide learner link. NodeActionBar in CLASS MODE
 * (`classId` set) is the same bar, collapsed to one verb, minting the same
 * personal link the school page mints — POSTed to the class's SCHOOL node,
 * because that is where /api/groups/:id/invites authorizes and where the
 * server checks the class belongs, and carrying `personal.class_id` so the
 * student lands in THIS class.
 *
 * Without class mode the bar shows "Invite a person" and posts no class_id —
 * these specs fail on that code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeActionBar from './NodeActionBar.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getClient: () => ({}), getAuthToken: async () => 'test-token' }),
}))

let posts: { url: string; body: any }[] = []

beforeEach(() => {
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ url: 'https://app/redeem/ABC123', code: 'ABC123' }) }
    }
    return { ok: true, status: 200, json: async () => ({ links: [] }) }
  }))
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

function mountClassBar() {
  return mount(NodeActionBar, {
    props: {
      // The class's SCHOOL node — never the class id.
      node: { id: 'school-node-1', name: 'Ysgol y Garnedd', label: 'school' },
      member: true,
      classId: 'class-7b',
    },
    global: { stubs: { NodeEntitlementControl: true, ConfirmDeleteModal: true, ManagerOnboardingGate: true } },
  })
}

describe('NodeActionBar — class mode', () => {
  it('shows exactly one verb, and it says Invite students', () => {
    const w = mountClassBar()
    const verbs = w.findAll('.verb-bar button').map((b) => b.text())
    expect(verbs).toEqual(['Invite students'])
  })

  it('mints a student link scoped to the class, on the school node', async () => {
    const w = mountClassBar()
    await w.find('[data-walk="verb-invite-student"]').trigger('click')
    // No role picker in class mode — a class invites students, full stop.
    expect(w.find('[data-walk="invite-form-role"]').exists()).toBe(false)
    await w.find('input[type="text"]').setValue('Megan')
    await w.find('[data-walk="invite-form-submit"]').trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/groups/school-node-1/invites')
    expect(posts[0].body.role).toBe('student')
    expect(posts[0].body.personal).toMatchObject({ name: 'Megan', class_id: 'class-7b' })
    expect(w.emitted('minted')).toBeTruthy()
  })

  it('leaves the school-level bar alone — every verb, no class_id', async () => {
    const w = mount(NodeActionBar, {
      props: { node: { id: 'school-node-1', name: 'Ysgol y Garnedd', label: 'school' }, member: true },
      global: { stubs: { NodeEntitlementControl: true, ConfirmDeleteModal: true, ManagerOnboardingGate: true } },
    })
    const verbs = w.findAll('.verb-bar button').map((b) => b.text())
    expect(verbs).toContain('Invite a person')
    expect(verbs).toContain('Get a shareable link')
    await w.find('[data-walk="verb-invite-person"]').trigger('click')
    await w.find('input[type="text"]').setValue('Megan')
    await w.find('[data-walk="invite-form-submit"]').trigger('click')
    await flushPromises()
    expect(posts[0].body.personal.class_id).toBeUndefined()
  })
})
