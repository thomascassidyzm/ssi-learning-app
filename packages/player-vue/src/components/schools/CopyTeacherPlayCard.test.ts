/**
 * CopyTeacherPlayCard — the leader's repair for a teacher who played as
 * themselves. Pins the gate that matters in the UI:
 *   - nothing is applied until a preview has been read and confirmed
 *     (no Copy button before a preview, the apply POST only after the tap);
 *   - the preview reads in plain words, positions as the LEGO's own content
 *     in both languages, never "seed"/"lego"/numbers-as-jargon;
 *   - a refused apply (the View-as 403) shows the server's message and never
 *     a "Copied" line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CopyTeacherPlayCard from './CopyTeacherPlayCard.vue'

vi.mock('@/composables/schools/client', () => ({
  getSchoolsClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }),
}))

let fetchMock: ReturnType<typeof vi.fn>
const PREVIEW = {
  to_copy: { sessions: 74, player_events: 244, lego_progress: 0, seed_progress: 0, learner_lego_metrics: 0, learner_speaking_opportunities: 4, learner_lego_pairings: 1 },
  total_rows: 323, in_app_seconds: 1705, prior_runs: 0, nothing_to_copy: false,
  position: {
    teacher: { known: 'I still want', target: 'dw i dal yn moyn' },
    class: { known: null, target: null },
    resulting: { known: 'I still want', target: 'dw i dal yn moyn', taken_from_teacher: true },
  },
}
const TEACHERS = [{ user_id: 'u-ang', name: 'Angharad Jones' }, { user_id: 'u-hyw', name: 'Hywel Pugh' }]

function json(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}
function posts(path: string) {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(path))
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CopyTeacherPlayCard', () => {
  it('previews in plain words before any copy is possible, then applies only on confirm', async () => {
    fetchMock.mockResolvedValueOnce(json(PREVIEW))
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: TEACHERS } })
    expect(w.find('[data-walk="class-copy-play-apply"]').exists()).toBe(false)

    await w.find('[data-walk="class-copy-play-preview"]').trigger('click')
    await flushPromises()
    expect(posts('/preview')).toHaveLength(1)
    expect(JSON.parse(posts('/preview')[0][1].body)).toEqual({ class_id: 'class-1', teacher_user_id: 'u-ang' })
    expect(posts('/apply')).toHaveLength(0)

    const text = w.text()
    expect(text).toContain('74 sessions')
    expect(text).toContain('28 minutes in the app')
    expect(text).toContain('Class will be at: I still want / dw i dal yn moyn')
    expect(text).toContain('Class has reached: not started yet')
    expect(text).not.toMatch(/seed|lego/i)

    fetchMock.mockResolvedValueOnce(json({ copied: { sessions: 74, player_events: 244 }, total_rows: 318, in_app_seconds: 1705, cursor_taken_from_teacher: true, position: { class: { known: 'I still want', target: 'dw i dal yn moyn' } } }))
    await w.find('[data-walk="class-copy-play-apply"]').trigger('click')
    await flushPromises()
    expect(posts('/apply')).toHaveLength(1)
    expect(w.emitted('copied')).toHaveLength(1)
    expect(w.text()).toContain('Copied from Angharad Jones: 74 sessions, 244 moments in the app, 28 minutes in the app.')
    expect(w.text()).toContain('The class is now at: I still want / dw i dal yn moyn.')
  })

  it('a refused apply shows the server message and never says Copied', async () => {
    fetchMock.mockResolvedValueOnce(json(PREVIEW))
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: TEACHERS } })
    await w.find('[data-walk="class-copy-play-preview"]').trigger('click')
    await flushPromises()
    fetchMock.mockResolvedValueOnce(json({ error: 'Read-only while viewing as another user' }, false, 403))
    await w.find('[data-walk="class-copy-play-apply"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toBe('Read-only while viewing as another user')
    expect(w.text()).not.toContain('Copied from')
    expect(w.emitted('copied')).toBeUndefined()
  })

  it('changing the teacher throws away the previous preview', async () => {
    fetchMock.mockResolvedValueOnce(json(PREVIEW))
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: TEACHERS } })
    await w.find('[data-walk="class-copy-play-preview"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-walk="class-copy-play-apply"]').exists()).toBe(true)
    await w.find('select').setValue('u-hyw')
    await flushPromises()
    expect(w.find('[data-walk="class-copy-play-apply"]').exists()).toBe(false)
  })

  it('says so when there is nothing to copy', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...PREVIEW, to_copy: {}, total_rows: 0, nothing_to_copy: true }))
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: TEACHERS } })
    await w.find('[data-walk="class-copy-play-preview"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Nothing to copy')
    expect(w.find('[data-walk="class-copy-play-apply"]').exists()).toBe(false)
  })
})

// The honesty property the class page already keeps (classDetailPanels.ts)
// has to hold inside this card too: a FAILED teacher read is never voiced as
// "no teachers are linked". Caught by the nightly on 2026-09-11.
describe('CopyTeacherPlayCard — an empty list is only "no teachers" when the read was clean', () => {
  it('says the list could not be loaded, not that the class has no teachers', () => {
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: [], teachersState: 'error' } })
    expect(w.text()).not.toContain('No teachers are linked to this class yet')
    expect(w.text()).toContain("Couldn't load the teacher list")
  })

  it('says nothing about teachers while the read is still pending', () => {
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: [], teachersState: 'loading' } })
    expect(w.text()).not.toContain('No teachers are linked to this class yet')
    expect(w.text()).toContain('Loading the teacher list')
  })

  it('still says "no teachers" once the read resolved clean and empty', () => {
    const w = mount(CopyTeacherPlayCard, { props: { classId: 'class-1', teachers: [], teachersState: 'empty' } })
    expect(w.text()).toContain('No teachers are linked to this class yet')
  })
})
