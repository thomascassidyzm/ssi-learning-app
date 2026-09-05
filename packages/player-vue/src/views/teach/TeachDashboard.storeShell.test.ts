/**
 * A tutor inside the native shell is never shown — and can never reach — the
 * Paddle seat-purchase panel.
 *
 * The specimen this pins: a WEB build loaded inside the Android WebView, which
 * injects `window.__SSI_PLATFORM__ = { shell: 'webview' }` at boot. The build
 * constant is true in that artifact, so a panel gated on the build constant
 * alone renders anyway, and Subscribe reaches paddle.Checkout.open() — an
 * outside payment route for digital goods, and a hard store rejection.
 *
 * Two assertions, because either alone would have passed while the defect was
 * live: the panel is GONE, and the action behind it is INERT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { configurePlatform, resetPlatform } from '@/platform/capabilities'

const checkoutOpen = vi.fn()
vi.mock('@/lib/paddle', () => ({
  getPaddle: async () => ({ Checkout: { open: checkoutOpen } }),
  paddleConfig: { teacherMonthlyPriceId: 'pri_teacher', teacherAnnualPriceId: 'pri_teacher_yr' },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ params: {} }) }))

const TEACHER = {
  id: 't-1',
  display_name: 'Aran',
  bio: null,
  referral_active: true,
  own_subscription_id: null,
  teaching_languages: ['cym'],
  platform_status: null,
  platform_expires_at: null,
}

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    const ok = (json: any) => ({ ok: true, status: 200, json: async () => json })
    if (u.includes('/api/teacher/me')) return ok({ teacher: TEACHER })
    if (u.includes('/api/courses/available')) return ok([])
    return ok({})
  }))
}

async function render() {
  const supabase = ref({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok', user: { id: 'auth-1', email: 'a@b.co' } } },
      }),
    },
    from: () => {
      const chain: any = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        maybeSingle: async () => ({ data: null }), then: (r: any) => r({ data: [], error: null }),
      }
      return chain
    },
  })
  const TeachDashboard = (await import('./TeachDashboard.vue')).default
  const wrapper = mount(TeachDashboard, {
    global: { provide: { supabase }, stubs: { RouterLink: true, teleport: true } },
  })
  // defineAsyncComponent resolves on its own microtask chain — flush until the
  // lazily-imported billing panel has had every chance to appear.
  // defineAsyncComponent resolves through a real dynamic import, which Vitest
  // transforms on demand — a microtask flush alone can land before it.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 20))
    await flushPromises()
  }
  return wrapper
}

beforeEach(() => {
  checkoutOpen.mockClear()
  stubApi()
})
afterEach(() => {
  resetPlatform()
  vi.unstubAllGlobals()
})

describe('the tutor dashboard inside a store shell', () => {
  it('does not render the seat-purchase / billing panel', async () => {
    configurePlatform({ shell: 'webview' })
    const wrapper = await render()
    expect(wrapper.text()).not.toMatch(/Subscribe/i)
  })

  it('cannot open Paddle even if the action is invoked directly', async () => {
    configurePlatform({ shell: 'webview' })
    const wrapper = await render()
    await (wrapper.vm as any).startTrial()
    await flushPromises()
    expect(checkoutOpen).not.toHaveBeenCalled()
  })

  it('still shows it on the web — the gate is not a blanket off-switch', async () => {
    resetPlatform()
    const wrapper = await render()
    expect(wrapper.text()).toMatch(/Subscribe/i)
  })
})
