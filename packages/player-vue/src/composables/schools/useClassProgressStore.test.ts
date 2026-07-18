/**
 * Tests for the class-aware progress store (owner ruling 2026-07-16: class
 * as first-class learner). Verifies the routing decision itself: outside
 * class mode every call passes straight through to the base (RLS-bound)
 * store; in class mode every call goes to /api/school/class-progress
 * instead, and the base store is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createClassAwareProgressStore } from './useClassProgressStore'

const fetchMock = vi.fn()
global.fetch = fetchMock as any

function makeBaseStore() {
  return {
    getEnrollment: vi.fn(async () => ({ from: 'base' })),
    createEnrollment: vi.fn(async () => ({})),
    setEnrollmentCursor: vi.fn(async () => {}),
    setLivePosition: vi.fn(async () => {}),
    setMode: vi.fn(async () => {}),
    bumpInfplayRound: vi.fn(async () => {}),
    updateCurrentCycle: vi.fn(async () => {}),
    updateEnrollmentActivity: vi.fn(async () => {}),
    getLegoProgressById: vi.fn(async () => null),
    saveLegoProgress: vi.fn(async () => ({})),
    updateLegoProgress: vi.fn(async () => {}),
  }
}

function makeSupabase(token: string | null) {
  return {
    auth: { getSession: vi.fn(async () => ({ data: { session: token ? { access_token: token } : null } })) },
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { server: true } }) })
})

describe('createClassAwareProgressStore — outside class mode', () => {
  it('forwards every call straight to the base store, never calling fetch', async () => {
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref(null), ref(makeSupabase('tok')))

    await store.getEnrollment('learner-1', 'course-1')
    await store.setLivePosition('learner-1', 'course-1', 'S0001L01', 1, 0)
    await store.updateCurrentCycle('learner-1', 'course-1', 2)

    expect(base.getEnrollment).toHaveBeenCalledWith('learner-1', 'course-1')
    expect(base.setLivePosition).toHaveBeenCalledWith('learner-1', 'course-1', 'S0001L01', 1, 0, undefined)
    expect(base.updateCurrentCycle).toHaveBeenCalledWith('learner-1', 'course-1', 2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createClassAwareProgressStore — in class mode', () => {
  it('routes writes through /api/school/class-progress with the classId and auth token, never touching the base store', async () => {
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('staff-tok')))

    await store.setLivePosition('staff-learner-id', 'course-1', 'S0002L03', 2, 1)

    expect(base.setLivePosition).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/school/class-progress', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer staff-tok' }),
    }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body).toEqual({ classId: 'class-1', method: 'setLivePosition', args: ['S0002L03', 2, 1, null] })

    const result = await store.getEnrollment('staff-learner-id', 'course-1')
    // getEnrollment hydrates timestamp fields (see the date-hydration test
    // below); the base payload otherwise passes through untouched.
    expect(result).toMatchObject({ server: true })
  })

  // Regression: the class-progress endpoint returns raw JSON (ISO-string
  // timestamps), but the base ProgressStore.getEnrollment returns Date objects
  // and callers (the resume gap rule, daysSinceLastPractice) call .getTime() on
  // last_practiced_at. Before hydration, launching play-as-class for a class
  // with a practised enrollment white-screened the player with
  // "last_practiced_at.getTime is not a function".
  it('hydrates last_practiced_at / enrolled_at into Date objects so .getTime() callers do not crash', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          last_completed_lego_id: 'S0004L02',
          last_practiced_at: '2026-07-10T09:30:00.000Z',
          enrolled_at: '2026-06-01T00:00:00.000Z',
        },
      }),
    })
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    const row = await store.getEnrollment('l', 'c')
    expect(row.last_practiced_at).toBeInstanceOf(Date)
    expect(row.last_practiced_at.getTime()).toBe(Date.parse('2026-07-10T09:30:00.000Z'))
    expect(row.enrolled_at).toBeInstanceOf(Date)
    expect(row.last_completed_lego_id).toBe('S0004L02')
  })

  it('leaves a null last_practiced_at as null (a never-practised class enrollment)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { last_practiced_at: null, enrolled_at: null } }),
    })
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    const row = await store.getEnrollment('l', 'c')
    expect(row.last_practiced_at).toBeNull()
  })

  it('returns null enrollment untouched (no class enrollment yet)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) })
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    expect(await store.getEnrollment('l', 'c')).toBeNull()
  })

  it('never leaks the caller-supplied learnerId into the request — the server resolves it from classId', async () => {
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    await store.getEnrollment('staff-own-learner-id', 'course-1')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(JSON.stringify(body)).not.toContain('staff-own-learner-id')
  })

  it('throws when there is no auth session, rather than silently no-op-ing a write', async () => {
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase(null)))
    await expect(store.setLivePosition('l', 'c', 'S0001L01', 1, 0)).rejects.toThrow(/no auth session/)
  })

  it('surfaces the server error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Class not in caller scope' }) })
    const base = makeBaseStore()
    const store = createClassAwareProgressStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    await expect(store.setMode('l', 'c', 'infplay')).rejects.toThrow(/Class not in caller scope/)
  })
})
