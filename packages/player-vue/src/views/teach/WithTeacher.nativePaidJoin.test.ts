/**
 * A learner who ALREADY PAYS can join a paid class in a store build.
 *
 * Nothing about this path takes money. The learner has a live subscription, so
 * openCheckout()'s double-charge guard was always going to skip Paddle
 * entirely and do the enrol + roster-tag writes client-side. Yet the
 * store-build gate was placed at the TOP of openCheckout(), before that guard
 * ran — so a paying customer opening /with/:code in the Android shell was told
 * "not available in this version" and never joined the class they had already
 * bought access to.
 *
 * Found by an outside review of #509/#511, 2026-09-05. The gate belongs
 * immediately before the thing it guards — the Paddle checkout — and nowhere
 * earlier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { configurePlatform, resetPlatform } from '@/platform/capabilities'

const CLASS = {
  id: 'class-1',
  class_name: 'Cymraeg Tuesdays',
  course_code: 'cym_for_eng',
  student_join_code: 'ABC123',
  school_id: null,
  course_is_free: false,
}

/** Records every table write so the test can assert the join actually happened. */
function makeSupabase() {
  const writes: Array<{ table: string; op: string; row: any }> = []
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok', user: { id: 'auth-1', email: 'a@b.co' } } },
      }),
    },
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          // learners row resolves; no prior enrolment, so the insert must run.
          data: table === 'learners' ? { id: 'learner-1' } : null,
        }),
        insert: (row: any) => {
          writes.push({ table, op: 'insert', row })
          return chain
        },
        upsert: async (row: any) => {
          writes.push({ table, op: 'upsert', row })
          return { data: null, error: null }
        },
      }
      return chain
    },
  }
  return { client, writes }
}

let writes: Array<{ table: string; op: string; row: any }>

async function renderPaidClass() {
  const { client, writes: w } = makeSupabase()
  writes = w
  const WithTeacher = (await import('./WithTeacher.vue')).default
  const wrapper = mount(WithTeacher, {
    global: {
      provide: { supabase: ref(client) },
      mocks: { $route: { params: { code: 'ABC123' } } },
      stubs: { AtmosphereBackdrop: true, RouterLink: true },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/api/teacher/by-code')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          teacher: { id: 't-1', display_name: 'Aran', photo_url: null, bio: null, country: null, teaching_languages: ['cym'] },
          class: CLASS,
          seats_remaining: 5,
          is_full: false,
        }),
      }
    }
    if (u.includes('/api/subscription')) {
      // THE PREMISE: this learner already pays.
      return { ok: true, status: 200, json: async () => ({ isSubscribed: true }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
  vi.mock('vue-router', () => ({
    useRoute: () => ({ params: { code: 'ABC123' } }),
    useRouter: () => ({ push: vi.fn() }),
  }))
})

afterEach(() => {
  resetPlatform()
  vi.unstubAllGlobals()
})

describe('an already-subscribed learner joining a paid class', () => {
  it('is enrolled and rostered in a STORE build, not refused', async () => {
    configurePlatform({ shell: 'webview' })
    const wrapper = await renderPaidClass()

    ;(wrapper.vm as any).userId = 'auth-1'
    ;(wrapper.vm as any).userEmail = 'a@b.co'
    await (wrapper.vm as any).proceedAfterAuth()
    await flushPromises()

    expect((wrapper.vm as any).checkoutError).toBe('')
    expect((wrapper.vm as any).alreadySubscribed).toBe(true)
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(
      expect.arrayContaining(['course_enrollments:insert', 'user_tags:upsert'])
    )
  })

  it('still refuses a NON-subscriber in a store build — no dead Paddle button', async () => {
    configurePlatform({ shell: 'webview' })
    ;(globalThis.fetch as any).mockImplementation(async (url: any) => {
      const u = String(url)
      if (u.includes('/api/teacher/by-code')) {
        return { ok: true, status: 200, json: async () => ({ teacher: { id: 't-1', display_name: 'Aran', photo_url: null, bio: null, country: null, teaching_languages: ['cym'] }, class: CLASS, seats_remaining: 5, is_full: false }) }
      }
      if (u.includes('/api/subscription')) return { ok: true, status: 200, json: async () => ({ isSubscribed: false }) }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const wrapper = await renderPaidClass()
    ;(wrapper.vm as any).userId = 'auth-1'
    ;(wrapper.vm as any).userEmail = 'a@b.co'
    await (wrapper.vm as any).proceedAfterAuth()
    await flushPromises()

    expect((wrapper.vm as any).checkoutError).toMatch(/isn't available/i)
    expect(writes).toHaveLength(0)
  })
})
