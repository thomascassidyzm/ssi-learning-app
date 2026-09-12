/**
 * The learner postbox sheet: Send is inert on an empty box, a report posts
 * the client envelope with the text to /api/report/bug, and success shows
 * only the thank-you. Red before the sheet existed, green after.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import ReportBugSheet from './ReportBugSheet.vue'

vi.mock('@/platform/apiBase', () => ({ apiUrl: (p: string) => p }))
vi.mock('@/platform/capabilities', () => ({ platform: () => ({ shell: 'web' }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: ref({ fullPath: '/me' }) }) }))
vi.mock('@/composables/useBeltProgress', () => ({
  BELTS: [{ name: 'white' }, { name: 'yellow' }],
  getSharedBeltProgress: () => ({ lastLegoId: ref('S0012L02'), highestLegoId: ref('S0012L02'), highestBeltIndex: ref(1) }),
}))
vi.mock('@/composables/usePlayerLog', () => ({
  flushAllPlayerLogs: vi.fn(async () => {}),
  pendingPlayerEvents: () => [{ event_type: 'tap_pause', occurred_at: '2026-09-12T10:00:00.000Z', payload: null }],
}))

const legoRow = { target_text: 'dw i eisiau dysgu', target_text_roman: null, known_text: 'I want to learn' }
const supabase = ref({
  auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: legoRow }) }) }) }) }),
  storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/shot.png' } }) }) },
})

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const mountSheet = () =>
  mount(ReportBugSheet, {
    props: { courseCode: 'cym_for_eng' },
    global: { provide: { supabase, activeCourse: ref({ course_code: 'cym_for_eng' }) } },
  })

describe('ReportBugSheet', () => {
  it('does not send an empty report', async () => {
    const w = mountSheet()
    expect((w.get('[data-walk="report-bug-send"]').element as HTMLButtonElement).disabled).toBe(true)
    await w.get('[data-walk="report-bug-send"]').trigger('click')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts the text with the client envelope and shows only the thank-you', async () => {
    const w = mountSheet()
    await w.get('[data-walk="report-bug-text"]').setValue('I ended a session and came back at the start of White.')
    await w.get('[data-walk="report-bug-send"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/report/bug')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(String(init.body))
    expect(body.text).toContain('start of White')
    expect(body.course_code).toBe('cym_for_eng')
    expect(body.position).toEqual({ lego_id: 'S0012L02', belt: 'yellow', target_text: 'dw i eisiau dysgu', known_text: 'I want to learn' })
    expect(body.app_shell).toBe('web')
    expect(body.route).toBe('/me')
    expect(body.recent_events).toEqual([{ event_type: 'tap_pause', occurred_at: '2026-09-12T10:00:00.000Z', payload: null }])
    expect(typeof body.device.user_agent).toBe('string')
    expect(w.find('[data-walk="report-bug-thanks"]').exists()).toBe(true)
    expect(w.find('[data-walk="report-bug-text"]').exists()).toBe(false)
  })
})

// Job #342: on a 390x844 viewport the sheet's Send button sat behind the
// bottom nav (z-index 3000) and the tap was intercepted. Red at 1200, green
// above the nav. Source-level on purpose: jsdom lays nothing out.
describe('ReportBugSheet sits above the bottom nav', () => {
  it('scrim z-index is higher than BottomNav z-index', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const here = path.dirname(new URL(import.meta.url).pathname)
    const z = (file: string, selector: string): number => {
      const src = fs.readFileSync(path.join(here, file), 'utf8')
      const block = src.slice(src.indexOf(selector))
      const m = /z-index:\s*(\d+)/.exec(block)
      if (!m) throw new Error(`no z-index after ${selector} in ${file}`)
      return Number(m[1])
    }
    expect(z('ReportBugSheet.vue', '.bug-scrim {')).toBeGreaterThan(z('BottomNav.vue', '.bottom-nav {'))
  })
})
