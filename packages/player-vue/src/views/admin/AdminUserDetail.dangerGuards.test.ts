import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'

// Guards for the ssi_admin danger verbs on this view (docs/admin-danger-verbs.md):
//  - role selects STAGE instead of committing on @change; only Apply writes
//  - "Skip to end of trial" is a two-tap arm/confirm
// See AdminUserDetail.signinLink.test.ts for the mount/stub idiom.

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { learnerId: 'learner-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

function makeSupabaseStub() {
  const profileRow = {
    id: 'learner-1',
    user_id: 'auth-uid-1',
    display_name: 'Jane Teacher',
    created_at: '2026-01-01T00:00:00.000Z',
    educational_role: 'teacher',
    platform_role: null,
  }

  function chain(table: string): any {
    const builder: any = {}
    const passthrough = ['select', 'eq', 'order', 'limit', 'gte', 'in', 'is', 'not']
    for (const m of passthrough) builder[m] = vi.fn(() => builder)
    builder.single = vi.fn(async () => {
      if (table === 'learners') return { data: profileRow, error: null }
      return { data: null, error: null }
    })
    builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    builder.then = (resolve: any) => resolve({ data: [], error: null, count: 0 })
    return builder
  }

  return {
    from: (table: string) => chain(table),
    rpc: vi.fn(async () => ({ data: [], error: null })),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-1' } } })),
    },
  }
}

async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function mountView(): Promise<VueWrapper<any>> {
  const { default: AdminUserDetail } = await import('./AdminUserDetail.vue')
  const wrapper = mount(AdminUserDetail, {
    global: { provide: { supabase: ref(makeSupabaseStub()) } },
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('AdminUserDetail — danger-verb guards', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ users: [] }) }) as any)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function roleCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/admin/update-user-role'))
  }
  function trialCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/admin/set-trial'))
  }

  it('changing a role select stages the change — nothing is written until Apply', async () => {
    const wrapper = await mountView()

    const selects = wrapper.findAll('select.frost-select')
    const platformSelect = selects[0]
    await platformSelect.setValue('ssi_admin')
    await wrapper.vm.$nextTick()

    // No write yet — the old behaviour committed here.
    expect(roleCalls()).toHaveLength(0)

    // The apply row states the exact change and the blast radius.
    const applyRow = wrapper.find('.role-apply-row')
    expect(applyRow.exists()).toBe(true)
    expect(applyRow.text()).toContain('Platform role: none → ssi_admin')
    expect(applyRow.text()).toContain('every user, school and course')

    const applyBtn = wrapper.findAll('button').find(b => b.text().includes('Apply role change'))
    await applyBtn!.trigger('click')
    await flushPromises()

    expect(roleCalls()).toHaveLength(1)
    expect(JSON.parse(roleCalls()[0][1].body)).toEqual({
      learner_id: 'learner-1',
      field: 'platform_role',
      value: 'ssi_admin',
    })
  })

  it('Cancel discards the staged role change and writes nothing', async () => {
    const wrapper = await mountView()

    const selects = wrapper.findAll('select.frost-select')
    await selects[1].setValue('school_admin')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.role-apply-row').exists()).toBe(true)

    const cancelBtn = wrapper.find('.role-apply-row').findAll('button').find(b => b.text() === 'Cancel')
    await cancelBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.role-apply-row').exists()).toBe(false)
    expect(roleCalls()).toHaveLength(0)
    // Select snaps back to the profile's real value.
    expect((selects[1].element as HTMLSelectElement).value).toBe('teacher')
  })

  it('re-selecting the current value stages nothing', async () => {
    const wrapper = await mountView()
    const selects = wrapper.findAll('select.frost-select')
    await selects[1].setValue('teacher')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.role-apply-row').exists()).toBe(false)
  })

  it('Skip to end of trial requires a second, armed tap', async () => {
    const wrapper = await mountView()

    const skipBtn = wrapper.findAll('button').find(b => b.text().includes('Skip to end of trial'))
    await skipBtn!.trigger('click')
    await flushPromises()

    // First tap only arms — no write, the button re-labels, the note appears.
    expect(trialCalls()).toHaveLength(0)
    expect(skipBtn!.text()).toContain('Confirm — end trial now')
    expect(wrapper.find('.trial-arm-note').text()).toContain('Backdates')

    await skipBtn!.trigger('click')
    await flushPromises()
    expect(trialCalls()).toHaveLength(1)
    expect(JSON.parse(trialCalls()[0][1].body).action).toBe('expire')
  })

  it('an armed trial expire can be cancelled', async () => {
    const wrapper = await mountView()

    const skipBtn = wrapper.findAll('button').find(b => b.text().includes('Skip to end of trial'))
    await skipBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    const cancelBtn = wrapper.find('.trial-test-panel').findAll('button').find(b => b.text() === 'Cancel')
    await cancelBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(trialCalls()).toHaveLength(0)
    expect(wrapper.find('.trial-arm-note').exists()).toBe(false)
    expect(skipBtn!.text()).toContain('Skip to end of trial')
  })

  it('states the sign-in-link blast radius before minting', async () => {
    const wrapper = await mountView()
    const preface = wrapper.find('.signin-link-preface')
    expect(preface.exists()).toBe(true)
    expect(preface.text()).toContain('signed in as')
    expect(preface.text()).toContain('Jane Teacher')
  })
})
