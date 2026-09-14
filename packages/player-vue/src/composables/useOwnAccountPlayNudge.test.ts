/**
 * useOwnAccountPlayNudge (job #662, Tom 12:58Z): a teacher playing on their
 * own account the course their class is on gets a one-line steer to Play as
 * class; a course none of their classes is on, a guest, or a failed read
 * gets nothing. One teaching-context read per user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'tok' }),
}))

import { useOwnAccountPlayNudge, __resetOwnAccountPlayNudge } from './useOwnAccountPlayNudge'

const CTX = { groups: [{ id: 's1', label: 'school' }], classes: [{ id: 'c-10c', name: '10C', course_code: 'cym_s_for_eng' }], can_play_as_class: true }
const flush = async () => { await new Promise((r) => setTimeout(r, 0)); await nextTick() }

beforeEach(() => {
  __resetOwnAccountPlayNudge()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => CTX })))
})

describe('useOwnAccountPlayNudge', () => {
  it('names the class the teacher has on the course being played, and nothing for another course', async () => {
    const userId = ref<string | null>('u-florence')
    const course = ref('cym_s_for_eng')
    const { nudgeClass, dismiss } = useOwnAccountPlayNudge(userId, course)
    await flush()
    expect(nudgeClass.value).toEqual({ id: 'c-10c', name: '10C', course_code: 'cym_s_for_eng' })
    course.value = 'spa_for_eng'
    expect(nudgeClass.value).toBeNull()
    course.value = 'cym_s_for_eng'
    dismiss()
    expect(nudgeClass.value).toBeNull()
    expect((fetch as any).mock.calls).toHaveLength(1)
    expect(String((fetch as any).mock.calls[0][0])).toBe('/api/me/teaching-context')
  })

  it('a guest gets no read and no nudge; a failed read means no nudge', async () => {
    const { nudgeClass } = useOwnAccountPlayNudge(ref(null), ref('cym_s_for_eng'))
    await flush()
    expect(nudgeClass.value).toBeNull()
    expect((fetch as any).mock.calls).toHaveLength(0)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const second = useOwnAccountPlayNudge(ref('u-other'), ref('cym_s_for_eng'))
    await flush()
    expect(second.nudgeClass.value).toBeNull()
  })
})
