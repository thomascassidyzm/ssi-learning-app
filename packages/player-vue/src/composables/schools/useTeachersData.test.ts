import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  },
  writable: true,
})

function createMockClient() {
  return {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
    },
  } as any
}

/** Chainable Supabase mock dispatching by table — used by the admin-view (direct-read) test. */
function createChainableClient(responses: Record<string, any>) {
  let currentTable = ''
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        const resp = responses[currentTable] || { data: [], error: null }
        return (resolve: any) => resolve(resp)
      }
      return vi.fn(() => new Proxy({}, handler))
    }
  }
  return {
    from: vi.fn((table: string) => {
      currentTable = table
      return new Proxy({}, handler)
    }),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
    },
  } as any
}

describe('useTeachersData', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
    vi.unstubAllGlobals()
  })

  async function setup() {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient())
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = ({
      user_id: 'u-admin', learner_id: 'l-admin', display_name: 'Admin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1',
      _scopeSource: 'self',
    })
    const { useTeachersData } = await import('./useTeachersData')
    return useTeachersData()
  }

  // Root cause of the "school admin sees 0 staff" bug + the aggregation math
  // (co-taught attribution, practice-hour rounding, sorting) now live
  // server-side in roster.ts — see api/school/roster.test.ts. These tests
  // cover the thin client wrapper only: does it call the right endpoint with
  // the right auth, and pass the response through untouched?

  it('calls /api/school/roster with the bearer token and stores the teachers it returns', async () => {
    const td = await setup()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        school: {}, students: [],
        teachers: [
          { user_id: 'ut1', learner_id: 'l1', display_name: 'Alice', class_count: 1, student_count: 1, total_practice_hours: 1, joined_at: '2025-01-01' },
          { user_id: 'ut2', learner_id: 'l2', display_name: 'Zara', class_count: 2, student_count: 2, total_practice_hours: 3, joined_at: '2025-02-01' },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await td.fetchTeachers()

    expect(fetchMock).toHaveBeenCalledWith('/api/school/roster', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }))
    expect(td.teachers.value).toHaveLength(2)
    expect(td.teachers.value[1].display_name).toBe('Zara')
  })

  it('returns empty array when the endpoint reports no teachers', async () => {
    const td = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ school: {}, teachers: [], students: [] }),
    })))
    await td.fetchTeachers()
    expect(td.teachers.value).toEqual([])
  })

  it('does not fetch without school id', async () => {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient())
    const { useSchoolContext } = await import('./useSchoolContext')
    useSchoolContext() // no user selected
    const { useTeachersData } = await import('./useTeachersData')
    const td = useTeachersData()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await td.fetchTeachers()
    expect(td.teachers.value).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sets error on fetch failure', async () => {
    const td = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await td.fetchTeachers()
    expect(td.error.value).toBeTruthy()
  })

  it('fetches with an explicit schoolId parameter (still hits the caller-scoped endpoint)', async () => {
    const td = await setup()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ school: {}, students: [], teachers: [
        { user_id: 'ut1', learner_id: 'l1', display_name: 'Test', class_count: 0, student_count: 0, total_practice_hours: 0, joined_at: '' },
      ] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await td.fetchTeachers('explicit-school-id')
    expect(td.teachers.value).toHaveLength(1)
  })

  it('an ssi_admin admin-view (loadFromSchoolId fakes school_admin) keeps the direct read + aggregation, never the caller-scoped endpoint', async () => {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createChainableClient({
      user_tags: { data: [
        { user_id: 'ut1', added_at: '2025-01-01' },
        { user_id: 'ut2', added_at: '2025-02-01' },
      ], error: null },
      learners: { data: [
        { id: 'l1', user_id: 'ut1', display_name: 'Zara Teacher' },
        { id: 'l2', user_id: 'ut2', display_name: 'Alice Teacher' },
      ], error: null },
      classes: { data: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], error: null },
      class_teachers: { data: [
        { class_id: 'c1', teacher_user_id: 'ut1', is_lead: true },
        { class_id: 'c2', teacher_user_id: 'ut1', is_lead: true },
        { class_id: 'c3', teacher_user_id: 'ut2', is_lead: true },
      ], error: null },
      class_student_progress: { data: [
        { class_id: 'c1', total_practice_seconds: 3600 },
        { class_id: 'c1', total_practice_seconds: 7200 },
        { class_id: 'c3', total_practice_seconds: 1800 },
      ], error: null },
      sessions: { data: [
        { learner_id: 'l1', duration_seconds: 241 },
        { learner_id: 'l1', duration_seconds: 6 },
      ], error: null },
    }))
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = ({
      user_id: 'real-admin-uid', learner_id: 'l-admin', display_name: 'SSI Admin',
      educational_role: 'school_admin', platform_role: 'ssi_admin',
      school_id: 's1', _scopeSource: 'admin-view',
    })
    const { useTeachersData } = await import('./useTeachersData')
    const td = useTeachersData()

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await td.fetchTeachers()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(td.teachers.value).toHaveLength(2)
    const zara = td.teachers.value.find(t => t.display_name === 'Zara Teacher')!
    expect(zara.class_count).toBe(2)
    expect(zara.student_count).toBe(2)
    expect(zara.total_practice_hours).toBe(3)
    // own practice (their learner's sessions) is separate from student hours
    expect(zara.own_practice_minutes).toBe(4)
    const alice = td.teachers.value.find(t => t.display_name === 'Alice Teacher')!
    expect(alice.own_practice_minutes).toBe(0)
  })

  // --- removeTeacher: server-mediated (api/school/remove-staff.ts), replacing
  //     the direct client user_tags.update() that silently no-opped under
  //     own-row RLS (2026-07-16 teacher-loop audit finding). ---

  describe('removeTeacher', () => {
    function setupWithAuth() {
      const client = createMockClient()
      ;(client as any).auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) }
      return client
    }

    it('posts to /api/school/remove-staff with a bearer token and returns ok on success', async () => {
      const client = setupWithAuth()
      const { setSchoolsClient } = await import('./client')
      setSchoolsClient(client)
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
      vi.stubGlobal('fetch', fetchMock)

      const { useTeachersData } = await import('./useTeachersData')
      const td = useTeachersData()
      const result = await td.removeTeacher('teacher-x')

      expect(result).toEqual({ ok: true, error: null })
      expect(fetchMock).toHaveBeenCalledWith('/api/school/remove-staff', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ target_user_id: 'teacher-x' }),
      }))
      vi.unstubAllGlobals()
    })

    it('surfaces the server error on a rejected (non-admin) removal — never a false success', async () => {
      const client = setupWithAuth()
      const { setSchoolsClient } = await import('./client')
      setSchoolsClient(client)
      const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Only a school admin can remove staff' }) }))
      vi.stubGlobal('fetch', fetchMock)

      const { useTeachersData } = await import('./useTeachersData')
      const td = useTeachersData()
      const result = await td.removeTeacher('teacher-x')

      expect(result).toEqual({ ok: false, error: 'Only a school admin can remove staff' })
      vi.unstubAllGlobals()
    })
  })
})
