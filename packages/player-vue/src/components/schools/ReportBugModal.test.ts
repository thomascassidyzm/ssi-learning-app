/**
 * The dashboard bug modal posts to the SAME postbox as the learner sheet,
 * tagged source schools_dashboard with the page and the school in view, and
 * Send is inert on an empty box. Red before the modal existed, green after.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import ReportBugModal from './ReportBugModal.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

vi.mock('@/platform/apiBase', () => ({ apiUrl: (p: string) => p }))
vi.mock('@/platform/capabilities', () => ({ platform: () => ({ shell: 'web' }) }))
vi.mock('vue-router', () => {
  const current = ref({ fullPath: '/schools/classes/c-9', path: '/schools/classes/c-9', params: { id: 'c-9' } })
  return { useRouter: () => ({ currentRoute: current }), useRoute: () => current.value }
})
vi.mock('@/composables/useBeltProgress', () => ({ BELTS: [{ name: 'white' }], getSharedBeltProgress: () => null }))
vi.mock('@/composables/usePlayerLog', () => ({ flushAllPlayerLogs: vi.fn(async () => {}), pendingPlayerEvents: () => [] }))

const supabase = ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } })

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetchSpy)
  const ctx = useSchoolContext()
  ctx.clear()
  ;(ctx.currentUser as any).value = {
    user_id: 'admin-1', learner_id: 'l1', display_name: 'Chennai Lead', educational_role: 'school_admin',
    platform_role: null, school_id: 'sch-seaside', school_name: 'Seaside Model School',
  }
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

const el = <T extends HTMLElement>(walk: string): T => {
  const node = document.body.querySelector<T>(`[data-walk="${walk}"]`)
  if (!node) throw new Error(`no [data-walk="${walk}"] on body`)
  return node
}
const type = async (walk: string, value: string) => {
  const ta = el<HTMLTextAreaElement>(walk)
  ta.value = value
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 0))
}

describe('ReportBugModal', () => {
  it('does not send an empty report', () => {
    mount(ReportBugModal, { global: { provide: { supabase, activeCourse: null } } })
    expect(el<HTMLButtonElement>('schools-report-bug-send').disabled).toBe(true)
    el('schools-report-bug-send').click()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts to /api/report/bug tagged schools_dashboard with the page and school in view, then emits sent and close', async () => {
    const wrapper = mount(ReportBugModal, { global: { provide: { supabase, activeCourse: null } } })
    await type('schools-report-bug-happened', 'Students page shows 0 students')
    await type('schools-report-bug-expected', '12 students')
    el('schools-report-bug-send').click()
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/report/bug')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(String(init.body))
    expect(body.text).toBe('Students page shows 0 students\n\nExpected: 12 students')
    expect(body.source).toBe('schools_dashboard')
    expect(body.route).toBe('/schools/classes/c-9')
    expect(body.context).toMatchObject({ role: 'school_admin', school_id: 'sch-seaside', school_name: 'Seaside Model School', class_id: 'c-9' })
    expect(wrapper.emitted('sent')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
