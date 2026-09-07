/**
 * Tests for NodeActionBar's ADD A CLASS verb (founder ruling 2026-09-07:
 * "can a class exist without a teacher? I think it can - but someone has to
 * create it, so the class has to belong to a group somehow, even if the group
 * is the root group - the org itself").
 *
 * Fails on the pre-fix bar, which had no such verb at all — the only way to
 * make a class was the school lane's client insert, whose RLS policy forces
 * the creator to name themselves its teacher.
 *
 * Pinned here: the verb is present on a node for a LEADER (member mount), it
 * posts the node's own group_id to the server endpoint, and it names no
 * teacher — the teacherless class is the point, and a body that quietly
 * carried a teacher_user_id would defeat it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeActionBar from './NodeActionBar.vue'

// The course list is the live/beta catalogue, read through the bar's own
// admin client — the same source NodeEntitlementControl uses.
vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => ({
      from: () => ({
        select: () => ({
          in: () => ({
            order: async () => ({ data: [{ course_code: 'cym_s_for_eng', display_name: 'Welsh (Southern)' }], error: null }),
          }),
        }),
      }),
    }),
    getAuthToken: async () => 'test-token',
  }),
}))

let posts: Array<{ url: string; body: any }> = []

function setupFetch(response: any = { ok: true, status: 201, json: async () => ({ class: { id: 'c1' } }) }) {
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (init?.method === 'POST') posts.push({ url, body: JSON.parse(init.body) })
    if (url.includes('/api/school/create-class')) return response
    return { ok: true, status: 200, json: async () => ({}) }
  }))
}

function mountBar(props: Record<string, unknown> = {}) {
  return mount(NodeActionBar, {
    props: { node: { id: 'root-org', name: 'NPTC Group', label: 'group' }, ...props },
    global: { stubs: { NodeEntitlementControl: true, ConfirmDeleteModal: true, ManagerOnboardingGate: true } },
  })
}

function verb(wrapper: any, label: string) {
  return wrapper.findAll('button').find((b: any) => b.text() === label)
}

beforeEach(() => { setupFetch() })

describe('NodeActionBar — Add a class', () => {
  it('offers the verb on a node an admin is standing on', () => {
    expect(verb(mountBar(), 'Add a class')).toBeTruthy()
  })

  it('offers it on the LEADER (member) mount too — a school owner adds her own classes', () => {
    expect(verb(mountBar({ member: true }), 'Add a class')).toBeTruthy()
  })

  it('is hidden under the neutral dressing — a council has no classes', () => {
    expect(verb(mountBar({ preset: 'neutral' }), 'Add a class')).toBeFalsy()
  })

  it('is hidden in class mode — a class page carries one verb only', () => {
    expect(verb(mountBar({ classId: 'c-1' }), 'Add a class')).toBeFalsy()
  })

  it('posts the node\'s own group_id and NO teacher, then tells the host to refetch', async () => {
    const wrapper = mountBar({ member: true })
    await verb(wrapper, 'Add a class')!.trigger('click')
    await flushPromises()
    await wrapper.find('[data-walk="add-class-name"]').setValue('Year 7 Welsh')
    // FrostSelect is a custom control; drive the model the way the user's tap does.
    wrapper.findComponent({ name: 'FrostSelect' }).vm.$emit('update:modelValue', 'cym_s_for_eng')
    await flushPromises()
    await wrapper.find('[data-walk="add-class-submit"]').trigger('click')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0].url).toContain('/api/school/create-class')
    expect(posts[0].body).toEqual({ group_id: 'root-org', class_name: 'Year 7 Welsh', course_code: 'cym_s_for_eng' })
    expect(posts[0].body.teacher_user_id).toBeUndefined()
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  it('shows the server\'s own refusal rather than a false success', async () => {
    setupFetch({ ok: false, status: 403, json: async () => ({ error: 'That group is not yours to add a class to' }) })
    const wrapper = mountBar({ member: true })
    await verb(wrapper, 'Add a class')!.trigger('click')
    await flushPromises()
    await wrapper.find('[data-walk="add-class-name"]').setValue('Year 7 Welsh')
    wrapper.findComponent({ name: 'FrostSelect' }).vm.$emit('update:modelValue', 'cym_s_for_eng')
    await flushPromises()
    await wrapper.find('[data-walk="add-class-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('That group is not yours to add a class to')
    expect(wrapper.emitted('changed')).toBeFalsy()
  })
})
