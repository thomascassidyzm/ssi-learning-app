import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { learnerId: 'learner-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

// Generic chainable query-builder stub: every call resolves to an empty-but-
// valid result, except the `learners` single-row fetch used to populate the
// profile panel this test actually asserts on.
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

describe('AdminUserDetail — sign-in link rescue', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/admin/create-signin-link')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            action_link: 'https://staging.saysomethingin.app/auth/confirm?token=abc',
            email: 'jane@school.example',
          }),
        } as any
      }
      // /api/admin/users email enrichment call — irrelevant to this test.
      return { ok: true, json: async () => ({ users: [] }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('mints a sign-in link and renders it with the copy field and caveats', async () => {
    const { default: AdminUserDetail } = await import('./AdminUserDetail.vue')
    const supabase = makeSupabaseStub()

    const wrapper = mount(AdminUserDetail, {
      global: {
        provide: { supabase: ref(supabase) },
      },
    })

    // Let onMounted's fetchUserDetail() resolve.
    await flushPromises()
    await wrapper.vm.$nextTick()

    const button = wrapper.findAll('button').find(b => b.text().includes('Create sign-in link'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/create-signin-link',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ learner_id: 'learner-1' }),
      }),
    )

    const url = wrapper.find('.invite-link-url')
    expect(url.exists()).toBe(true)
    expect(url.text()).toContain('https://staging.saysomethingin.app/auth/confirm?token=abc')

    const caveat = wrapper.find('.signin-link-caveat')
    expect(caveat.text()).toContain('Single-use')
    expect(caveat.text()).toContain('expires in about an hour')
  })
})

async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}
