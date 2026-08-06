/**
 * The password gate in front of the org manager's first add (2026-08-06).
 *
 * Deborah, testing the org lane, asked what happens after a manager has built
 * their organisation. Today: nothing — they arrived by a magic link, never set
 * a password, and lose the organisation with the session. Tom's ruling was
 * "Password before adding a group or a learner".
 *
 * What is worth pinning here is the INTERCEPTION, not the modal's markup:
 * every verb that adds a group or a learner must open the gate instead of its
 * own form, the schools lane must be untouched, and a passworded manager must
 * see no gate at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => ({}),
    getAuthToken: async () => 'test-token',
  }),
}))

const leadsOrg = ref(false)
vi.mock('@/composables/useOrgLeadership', () => ({
  useOrgLeadership: () => ({
    leadsOrg,
    ensureLoaded: async () => {},
  }),
}))

import NodeActionBar from './NodeActionBar.vue'

const NODE = { id: 'org-1', name: 'Cardiff Council', label: 'group' }

/** The three verbs a manager holds. All of them add a group or a learner. */
const ADD_VERBS = ['Invite a person', 'Get a shareable link', 'Add a group']

function mountBar(opts: { member: boolean; leader: boolean; hasPassword: boolean }) {
  leadsOrg.value = opts.leader
  const auth = {
    user: ref({ id: 'u-1', user_metadata: opts.hasPassword ? { has_password: true } : {} }),
    updatePassword: vi.fn(async () => ({})),
  }
  const wrapper = mount(NodeActionBar, {
    props: { node: NODE, member: opts.member, preset: 'neutral' as const },
    global: {
      provide: { auth },
      stubs: { NodeEntitlementControl: true, ConfirmDeleteModal: true, ManagerOnboardingGate: true },
    },
  })
  return { wrapper, auth }
}

function clickVerb(wrapper: any, label: string) {
  const button = wrapper.findAll('button').find((b: any) => b.text() === label)
  expect(button, `verb "${label}" should be on the bar`).toBeTruthy()
  return button!.trigger('click')
}

function gate(wrapper: any) {
  return wrapper.findComponent({ name: 'ManagerOnboardingGate' })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})

describe('NodeActionBar — password before the first add', () => {
  it.each(ADD_VERBS)('opens the gate instead of the "%s" form', async (label) => {
    const { wrapper } = mountBar({ member: true, leader: true, hasPassword: false })
    await clickVerb(wrapper, label)
    expect(gate(wrapper).props('isOpen')).toBe(true)
    // The verb's own form must NOT have opened behind it.
    expect(wrapper.find('input.frost-input').exists()).toBe(false)
  })

  it('lets a manager who already has a password straight through', async () => {
    const { wrapper } = mountBar({ member: true, leader: true, hasPassword: true })
    await clickVerb(wrapper, 'Add a group')
    expect(gate(wrapper).props('isOpen')).toBe(false)
    expect(wrapper.find('input.frost-input').exists()).toBe(true)
  })

  it('leaves the SCHOOLS lane alone — a non-org leader is never gated', async () => {
    // /org/:id renders school nodes on the same member mount, so gating on
    // `member` alone would leak into the schools lane.
    const { wrapper } = mountBar({ member: true, leader: false, hasPassword: false })
    await clickVerb(wrapper, 'Add a group')
    expect(gate(wrapper).props('isOpen')).toBe(false)
    expect(wrapper.find('input.frost-input').exists()).toBe(true)
  })

  it('does not gate the ssi_admin god-view mount', async () => {
    const { wrapper } = mountBar({ member: false, leader: true, hasPassword: false })
    await clickVerb(wrapper, 'Add a group')
    expect(gate(wrapper).props('isOpen')).toBe(false)
  })

  it('carries straight on into the verb once the password is saved', async () => {
    const { wrapper } = mountBar({ member: true, leader: true, hasPassword: false })
    await clickVerb(wrapper, 'Add a group')
    expect(wrapper.find('input.frost-input').exists()).toBe(false)

    // The gate reports the password saved — the manager must NOT have to find
    // the button again.
    await gate(wrapper).vm.$emit('passworded')
    await wrapper.vm.$nextTick()
    const input = wrapper.find('input.frost-input')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('Group name')
  })

  it('drops the pending verb when the gate is closed without a password', async () => {
    const { wrapper } = mountBar({ member: true, leader: true, hasPassword: false })
    await clickVerb(wrapper, 'Add a group')
    await gate(wrapper).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(gate(wrapper).props('isOpen')).toBe(false)
    expect(wrapper.find('input.frost-input').exists()).toBe(false)
  })
})
