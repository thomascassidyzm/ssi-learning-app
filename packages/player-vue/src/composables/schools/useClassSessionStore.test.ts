/**
 * Tests for the class-aware session store — mirrors
 * useClassProgressStore.test.ts's routing-decision coverage: outside class
 * mode every call passes straight through to the base (RLS-bound) store; in
 * class mode every call goes to /api/school/class-progress instead, and the
 * base store is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createClassAwareSessionStore } from './useClassSessionStore'

const fetchMock = vi.fn()
global.fetch = fetchMock as any

function makeBaseStore() {
  return {
    startSession: vi.fn(async () => ({ id: 'base-session-1', learner_id: 'staff-learner-id' })),
    checkpointSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => ({})),
    saveMetrics: vi.fn(async () => {}),
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

describe('createClassAwareSessionStore — outside class mode', () => {
  it('forwards every call straight to the base store, never calling fetch', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref(null), ref(makeSupabase('tok')))

    await store.startSession('learner-1', 'course-1')
    await store.checkpointSession('sess-1', 5, 60)
    await store.endSession('sess-1', { items_practiced: 5, started_at: new Date() }, 120)

    expect(base.startSession).toHaveBeenCalledWith('learner-1', 'course-1')
    expect(base.checkpointSession).toHaveBeenCalledWith('sess-1', 5, 60)
    expect(base.endSession).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createClassAwareSessionStore — in class mode', () => {
  it('startSession routes through /api/school/class-progress with the classId and auth token, never touching the base store', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('staff-tok')))

    await store.startSession('staff-learner-id', 'course-1')

    expect(base.startSession).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/school/class-progress', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer staff-tok' }),
    }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body).toEqual({ classId: 'class-1', method: 'startSession', args: [] })
  })

  it('never leaks the caller-supplied learnerId/courseId into the startSession request — the server resolves them from classId', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    await store.startSession('staff-own-learner-id', 'course-1')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(JSON.stringify(body)).not.toContain('staff-own-learner-id')
  })

  it('checkpointSession forwards sessionId/itemsPracticed/durationSeconds as args', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    await store.checkpointSession('sess-9', 12, 300)
    expect(base.checkpointSession).not.toHaveBeenCalled()
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body).toEqual({ classId: 'class-1', method: 'checkpointSession', args: ['sess-9', 12, 300] })
  })

  it('endSession forwards measured PLAY seconds, not the wall-clock span', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    const startedAt = new Date('2026-07-20T10:00:00.000Z')
    const endedAt = new Date('2026-07-20T10:05:00.000Z')
    // The class sat open for 5 minutes of wall clock (300s) but only played
    // for 180s. A class left running on a whiteboard over lunch must not bill
    // the lunch to the pupils (owner ruling 2026-08-19).
    await store.endSession('sess-9', { items_practiced: 30, started_at: startedAt, ended_at: endedAt }, 180)
    expect(base.endSession).not.toHaveBeenCalled()
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body).toEqual({ classId: 'class-1', method: 'endSession', args: ['sess-9', 30, 180] })
  })

  it('saveMetrics is a no-op in class mode — never calls fetch or the base store', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    await store.saveMetrics('sess-9', [{ id: 'm1' }])
    expect(base.saveMetrics).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when there is no auth session, rather than silently no-op-ing a write', async () => {
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase(null)))
    await expect(store.startSession('l', 'c')).rejects.toThrow(/no auth session/)
  })

  it('surfaces the server error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Class not in caller scope' }) })
    const base = makeBaseStore()
    const store = createClassAwareSessionStore(ref(base), ref({ id: 'class-1' }), ref(makeSupabase('tok')))
    await expect(store.startSession('l', 'c')).rejects.toThrow(/Class not in caller scope/)
  })
})
