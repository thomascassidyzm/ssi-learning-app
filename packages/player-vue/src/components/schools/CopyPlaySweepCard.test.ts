/**
 * CopyPlaySweepCard — the school leader's sweep (job #662). Pins:
 *   - one candidates read on mount, rendering each pair's preview figures in
 *     plain words (sessions, minutes, positions as the LEGO's own content);
 *   - Copy is per row: the apply POST carries THAT row's class and teacher,
 *     and the row shows the server's result line; no select-all exists;
 *   - a refused apply (the View-as 403) shows the server's message on the
 *     row and never a "Copied" line;
 *   - zero candidates says so in words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CopyPlaySweepCard from './CopyPlaySweepCard.vue'

vi.mock('@/composables/schools/client', () => ({
  getSchoolsClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }),
}))

let fetchMock: ReturnType<typeof vi.fn>
const pair = (classId: string, className: string, uid: string, name: string, seconds: number) => ({
  class_id: classId, class_name: className, course_code: 'cym_s_for_eng',
  teacher: { user_id: uid, name, learner_id: `l-${uid}` },
  to_copy: { sessions: 2, player_events: 125 }, total_rows: 127, in_app_seconds: seconds, minutes_to_add: 12, prior_runs: 0, nothing_to_copy: false,
  position: { teacher: { known: 'I still want', target: 'dw i dal yn moyn' }, class: { known: null, target: null }, resulting: { known: 'I still want', target: 'dw i dal yn moyn', taken_from_teacher: true } },
})
const CANDIDATES = { school_id: 'chepstow', classes_checked: 3, pairs_checked: 2, candidates: [pair('c-10c', '10C', 'u-florence', 'florencecotten', 722), pair('c-8b', '8B', 'u-ben', 'benjones', 150)] }
const APPLIED = { audit_id: 'a1', copied: { sessions: 2, player_events: 125 }, total_rows: 127, in_app_seconds: 722, cursor_taken_from_teacher: true, position: { class: { known: 'I still want', target: 'dw i dal yn moyn' } } }

function json(body: any, ok = true, status = 200) { return { ok, status, json: async () => body } }
function posts(path: string) { return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(path)) }

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CopyPlaySweepCard', () => {
  it('names the other class a teacher\'s same play is listed under, so the leader copies it onto one class (job #792)', async () => {
    const rose = pair('c-7e', '7E', 'u-rose', 'roseribbeck', 500)
    fetchMock.mockResolvedValueOnce(json({ ...CANDIDATES, candidates: [{ ...rose, also_offered_on: ['11S'] }, pair('c-8b', '8B', 'u-ben', 'benjones', 150)] }))
    const w = mount(CopyPlaySweepCard)
    await flushPromises()
    const cues = w.findAll('[data-walk="school-copy-play-sweep-one-class"]')
    expect(cues).toHaveLength(1)
    expect(cues[0].text()).toContain('same play as the roseribbeck row under 11S')
    expect(cues[0].text()).toContain('one class')
  })

  it('lists every pair with its preview figures, copies ONE row on its own button, and shows the server\'s result line', async () => {
    fetchMock.mockResolvedValueOnce(json(CANDIDATES)).mockResolvedValueOnce(json(APPLIED))
    const w = mount(CopyPlaySweepCard)
    await flushPromises()
    expect(posts('/candidates')).toHaveLength(1)
    const text = w.text()
    expect(text).toContain('10C')
    expect(text).toContain('florencecotten')
    expect(text).toContain('8B')
    expect(text).toContain('benjones')
    expect(text).toContain('2 sessions')
    expect(text).toContain('125 moments in the app')
    expect(text).toContain('13 minutes in the app')
    expect(text).toContain('Class will be at: I still want / dw i dal yn moyn')
    expect(text).toContain('Class has reached: not started yet')
    // One Copy per row, and nothing that copies everyone.
    const buttons = w.findAll('[data-walk="school-copy-play-sweep-copy"]')
    expect(buttons).toHaveLength(2)
    expect(text).not.toMatch(/select all|copy all/i)

    await buttons[1].trigger('click')
    await flushPromises()
    expect(posts('/apply')).toHaveLength(1)
    expect(JSON.parse(posts('/apply')[0][1].body)).toEqual({ class_id: 'c-8b', teacher_user_id: 'u-ben' })
    const done = w.find('[data-walk="school-copy-play-sweep-done"]')
    expect(done.exists()).toBe(true)
    expect(done.text()).toContain('Copied from benjones: 2 sessions, 125 moments in the app, 13 minutes in the app.')
    expect(done.text()).toContain('The class is now at: I still want / dw i dal yn moyn.')
    // The other row still has its own button.
    expect(w.findAll('[data-walk="school-copy-play-sweep-copy"]')).toHaveLength(1)
    expect(w.emitted('copied')).toHaveLength(1)
  })

  it('a refused apply shows the server\'s message on that row and never a Copied line', async () => {
    fetchMock.mockResolvedValueOnce(json(CANDIDATES)).mockResolvedValueOnce(json({ error: 'Read-only while viewing as another user' }, false, 403))
    const w = mount(CopyPlaySweepCard)
    await flushPromises()
    await w.findAll('[data-walk="school-copy-play-sweep-copy"]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Read-only while viewing as another user')
    expect(w.text()).not.toContain('Copied from')
    expect(w.findAll('[data-walk="school-copy-play-sweep-copy"]')).toHaveLength(2)
  })

  it('zero candidates says there is nothing to copy, in words', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...CANDIDATES, candidates: [] }))
    const w = mount(CopyPlaySweepCard)
    await flushPromises()
    expect(w.find('[data-walk="school-copy-play-sweep-empty"]').text()).toContain('Nothing to copy')
    expect(w.findAll('[data-walk="school-copy-play-sweep-copy"]')).toHaveLength(0)
  })
})
