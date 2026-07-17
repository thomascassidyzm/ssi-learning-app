import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock localStorage
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

/** Build a chainable Supabase mock dispatching by table */
function createMockClient(responses: Record<string, any>) {
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

describe('useSchoolData', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })

  async function setup(responses: Record<string, any> = {}, role: string = 'school_admin') {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient(responses))

    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()

    // Set up a user matching the role
    if (role === 'govt_admin') {
      ctx.currentUser.value = ({
        user_id: 'u1', learner_id: 'l1', display_name: 'Gov',
        educational_role: 'govt_admin', platform_role: null,
        region_code: 'WALES'
      })
    } else if (role === 'school_admin') {
      ctx.currentUser.value = ({
        user_id: 'u2', learner_id: 'l2', display_name: 'Admin',
        educational_role: 'school_admin', platform_role: null,
        school_id: 's1', _scopeSource: 'self',
      })
    } else if (role === 'teacher') {
      ctx.currentUser.value = ({
        user_id: 'u3', learner_id: 'l3', display_name: 'Teacher',
        educational_role: 'teacher', platform_role: null,
        school_id: 's1', _scopeSource: 'self',
      })
    }

    const { useSchoolData } = await import('./useSchoolData')
    return useSchoolData()
  }

  it('fetches all schools for govt_admin (legacy region_code, no group_id)', async () => {
    const sd = await setup({
      school_summary: {
        data: [
          { school_id: 's1', school_name: 'School A', region_code: 'WALES', admin_user_id: 'u1', teacher_count: 5, class_count: 3, student_count: 50, total_practice_hours: 100, created_at: '2025-01-01' },
          { school_id: 's2', school_name: 'School B', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 3, class_count: 2, student_count: 30, total_practice_hours: 60, created_at: '2025-02-01' },
        ],
        error: null,
      },
      region_summary: {
        data: { region_code: 'WALES', region_name: 'Wales', school_count: 2, teacher_count: 8, student_count: 80, total_practice_hours: 160 },
        error: null,
      },
    }, 'govt_admin')

    await sd.fetchSchools()
    expect(sd.schools.value).toHaveLength(2)
    expect(sd.groupSummary.value?.student_count).toBe(80)
  })

  it('fetches group + schools for govt_admin (group_id path) via the server-mediated endpoint, not a direct view read', async () => {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient({}))
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = ({
      user_id: 'u1', learner_id: 'l1', display_name: 'Gov',
      educational_role: 'govt_admin', platform_role: null,
      group_id: 'g1', group_path: 'ime-demo-programme', _scopeSource: 'self',
    })
    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()

    // Root cause of the "group dashboard shows zeros" bug: group_summary /
    // school_summary are RLS-invoker views that LATERAL-join user_tags, which
    // has no govt_admin SELECT branch — a direct client read as the group
    // leader's own session silently zeroed every teacher/student/hours count.
    // The fix reads via a server-mediated endpoint instead of the client
    // Supabase table/view reads used by the other roles above.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        group: {
          group_id: 'g1', group_name: 'IME Demo Programme', group_path: 'ime-demo-programme',
          name_confirmed: true, school_count: 3, teacher_count: 5, student_count: 80, total_practice_hours: 256.6,
        },
        schools: [
          { school_id: 's1', school_name: 'Sunrise', admin_user_id: 'u1', teacher_count: 3, class_count: 3, student_count: 42, total_practice_hours: 129.9, created_at: '2025-01-01', active_days_last_7: 5, has_admin: true },
          { school_id: 's2', school_name: 'Green Valley', admin_user_id: null, teacher_count: 0, class_count: 0, student_count: 0, total_practice_hours: 0, created_at: '2025-01-01', active_days_last_7: 0, has_admin: false },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sd.fetchSchools()

    expect(fetchMock).toHaveBeenCalledWith('/api/school/group-summary', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }))
    expect(sd.schools.value).toHaveLength(2)
    expect(sd.schools.value[0].student_count).toBe(42)
    expect(sd.groupSummary.value?.student_count).toBe(80)
    expect(sd.groupSummary.value?.teacher_count).toBe(5)
    expect(sd.groupSummary.value?.total_practice_hours).toBeCloseTo(256.6)
    vi.unstubAllGlobals()
  })

  it('an ssi_admin admin-view of a group (/admin/groups/:id) passes ?groupId= so group-summary\'s admin passthrough can resolve it', async () => {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient({}))
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = ({
      user_id: 'real-admin-uid', learner_id: 'l-admin', display_name: 'SSI Admin',
      educational_role: 'govt_admin', platform_role: 'ssi_admin',
      group_id: 'g9', group_path: 'some-group', _scopeSource: 'admin-view',
    })
    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        group: { group_id: 'g9', group_name: 'Some Group', school_count: 1, teacher_count: 1, student_count: 1, total_practice_hours: 1 },
        schools: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sd.fetchSchools()

    expect(fetchMock).toHaveBeenCalledWith('/api/school/group-summary?groupId=g9', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }))
    expect(sd.groupSummary.value?.group_id).toBe('g9')
    vi.unstubAllGlobals()
  })

  it('fetches single school for school_admin via the server-mediated endpoint, not a direct view read', async () => {
    const sd = await setup({
      schools: {
        data: { teacher_join_code: 'ABC123' },
        error: null,
      },
    }, 'school_admin')

    // Root cause of the "school admin sees 0 staff/0 students" bug:
    // school_summary is an RLS-invoker view that LATERAL-joins user_tags,
    // whose SELECT policy misses a school_admin invite-born via the newer
    // school_admin_join redemption path (schools.admin_user_id stays null
    // there) — a direct client read as that admin's own session silently
    // zeroed every teacher/student count. Fixed via /api/school/roster.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        school: { school_id: 's1', school_name: 'My School', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 4, class_count: 2, student_count: 25, total_practice_hours: 50, created_at: '2025-01-01' },
        teachers: [],
        students: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sd.fetchSchools()

    expect(fetchMock).toHaveBeenCalledWith('/api/school/roster', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }))
    expect(sd.currentSchool.value?.school_name).toBe('My School')
    expect(sd.currentSchool.value?.teacher_count).toBe(4)
    expect(sd.currentSchool.value?.student_count).toBe(25)
    expect(sd.currentSchool.value?.teacher_join_code).toBe('ABC123')
    expect(sd.schools.value).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('an ssi_admin admin-view (loadFromSchoolId fakes school_admin) keeps the direct view read, never the caller-scoped endpoint', async () => {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient({
      school_summary: {
        data: { school_id: 's9', school_name: 'Admin-Viewed School', region_code: 'WALES', admin_user_id: null, teacher_count: 4, class_count: 2, student_count: 25, total_practice_hours: 50, created_at: '2025-01-01' },
        error: null,
      },
      schools: { data: { teacher_join_code: 'Q1' }, error: null },
    }))
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = ({
      user_id: 'real-admin-uid', learner_id: 'l-admin', display_name: 'SSI Admin',
      educational_role: 'school_admin', platform_role: 'ssi_admin',
      school_id: 's9', _scopeSource: 'admin-view',
    })
    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await sd.fetchSchools()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sd.currentSchool.value?.school_name).toBe('Admin-Viewed School')
    expect(sd.currentSchool.value?.student_count).toBe(25)
    vi.unstubAllGlobals()
  })

  it('fetches single school for teacher via the server-mediated endpoint', async () => {
    const sd = await setup({
      schools: {
        data: { teacher_join_code: 'XYZ789' },
        error: null,
      },
    }, 'teacher')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        school: { school_id: 's1', school_name: 'My School', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 4, class_count: 2, student_count: 25, total_practice_hours: 50, created_at: '2025-01-01' },
        teachers: [],
        students: [],
      }),
    })))

    await sd.fetchSchools()
    expect(sd.currentSchool.value?.school_name).toBe('My School')
    vi.unstubAllGlobals()
  })

  // --- drill-down ---

  it('drill-down: selectSchoolToView and clearViewingSchool', async () => {
    const sd = await setup({}, 'govt_admin')
    const school = {
      id: 's1', school_name: 'Test', region_code: 'WALES', admin_user_id: 'u1',
      teacher_join_code: '', admin_join_code: 'ADM-001', teacher_count: 1, class_count: 1, student_count: 10,
      total_practice_hours: 20, created_at: '2025-01-01',
    }
    sd.selectSchoolToView(school)
    expect(sd.isViewingSchool.value).toBe(true)
    expect(sd.activeSchool.value?.id).toBe('s1')
    sd.clearViewingSchool()
    expect(sd.isViewingSchool.value).toBe(false)
  })

  // --- computed totals ---

  it('totalStudents uses viewingSchool when drilled down', async () => {
    const sd = await setup({}, 'govt_admin')
    const school = {
      id: 's1', school_name: 'Test', region_code: 'WALES', admin_user_id: 'u1',
      teacher_join_code: '', admin_join_code: 'ADM-002', teacher_count: 1, class_count: 1, student_count: 42,
      total_practice_hours: 20, created_at: '2025-01-01',
    }
    sd.selectSchoolToView(school)
    expect(sd.totalStudents.value).toBe(42)
  })

  it('totalStudents sums schools when no drill-down and no group summary', async () => {
    const sd = await setup({}, 'govt_admin')
    sd.schools.value = [
      { id: 's1', school_name: 'A', region_code: null, admin_user_id: 'u1', teacher_join_code: '', admin_join_code: 'ADM-003', teacher_count: 1, class_count: 1, student_count: 10, total_practice_hours: 5, created_at: '' },
      { id: 's2', school_name: 'B', region_code: null, admin_user_id: 'u2', teacher_join_code: '', admin_join_code: 'ADM-004', teacher_count: 1, class_count: 1, student_count: 20, total_practice_hours: 10, created_at: '' },
    ]
    sd.groupSummary.value = null
    expect(sd.totalStudents.value).toBe(30)
  })

  it('totalPracticeHours uses groupSummary when available', async () => {
    const sd = await setup({}, 'govt_admin')
    sd.groupSummary.value = { region_code: 'W', group_name: 'Wales', school_count: 1, teacher_count: 1, student_count: 1, total_practice_hours: 999 }
    expect(sd.totalPracticeHours.value).toBe(999)
  })

  it('threads staff_practice_hours from the roster so the headline can show the honest composition (Chepstow, staff-only school)', async () => {
    // Founder ruling 2026-07-18: headline hours include staff's OWN practice.
    // Chepstow is a trial school where ONLY staff (Lucy) have practised —
    // total_practice_hours already INCLUDES her minutes, and staff_practice_hours
    // breaks them out so the UI shows "incl. Xm staff practice", never a bare 0.
    const sd = await setup({
      schools: { data: { teacher_join_code: 'CHEP' }, error: null },
    }, 'school_admin')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        // Lucy's 4m of own practice, no students yet: total == staff.
        school: { school_id: 'chepstow', school_name: 'Chepstow', region_code: 'WALES', admin_user_id: null, teacher_count: 1, class_count: 0, student_count: 0, total_practice_hours: 4 / 60, staff_practice_hours: 4 / 60, created_at: '2025-01-01' },
        teachers: [], students: [],
      }),
    })))

    await sd.fetchSchools()

    expect(sd.currentSchool.value?.staff_practice_hours).toBeCloseTo(4 / 60)
    expect(sd.totalPracticeHours.value).toBeCloseTo(4 / 60)
    // The composition equals the whole headline here — every practised minute is staff's.
    expect(sd.totalStaffPracticeHours.value).toBeCloseTo(4 / 60)
    vi.unstubAllGlobals()
  })

  it('totalStaffPracticeHours sums schools and prefers groupSummary/viewingSchool', async () => {
    const sd = await setup({}, 'govt_admin')
    sd.schools.value = [
      { id: 's1', school_name: 'A', region_code: null, admin_user_id: 'u1', teacher_join_code: '', admin_join_code: 'ADM-101', teacher_count: 1, class_count: 1, student_count: 10, total_practice_hours: 5, staff_practice_hours: 1, created_at: '' },
      { id: 's2', school_name: 'B', region_code: null, admin_user_id: 'u2', teacher_join_code: '', admin_join_code: 'ADM-102', teacher_count: 1, class_count: 1, student_count: 20, total_practice_hours: 10, staff_practice_hours: 2, created_at: '' },
    ]
    sd.groupSummary.value = null
    expect(sd.totalStaffPracticeHours.value).toBe(3)

    sd.groupSummary.value = { region_code: 'W', group_name: 'Wales', school_count: 2, teacher_count: 2, student_count: 30, total_practice_hours: 15, staff_practice_hours: 3 }
    expect(sd.totalStaffPracticeHours.value).toBe(3)
  })

  it('does not fetch if no selected user', async () => {
    const { setSchoolsClient } = await import('./client')
    const mockClient = createMockClient({})
    setSchoolsClient(mockClient)
    const { useSchoolContext } = await import('./useSchoolContext')
    useSchoolContext() // no user selected
    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()
    await sd.fetchSchools()
    expect(mockClient.from).not.toHaveBeenCalled()
  })

  // --- confirm/rename (invite-born admin first-run card) ---

  it('confirmSchoolName updates the school_name + name_confirmed and syncs currentSchool', async () => {
    const sd = await setup({}, 'school_admin')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        school: { school_id: 's1', school_name: 'Ysgol y Garnedd', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 0, class_count: 0, student_count: 0, total_practice_hours: 0, created_at: '2025-01-01', name_confirmed: false },
        teachers: [],
        students: [],
      }),
    })))
    await sd.fetchSchools()
    expect(sd.currentSchool.value?.name_confirmed).toBe(false)

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ school: {} }) }))
    vi.stubGlobal('fetch', fetchMock)

    const ok = await sd.confirmSchoolName('s1', 'Ysgol y Garnedd (Bangor)')
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/school/update-profile', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ school_name: 'Ysgol y Garnedd (Bangor)', name_confirmed: true }),
    }))
    expect(sd.currentSchool.value?.school_name).toBe('Ysgol y Garnedd (Bangor)')
    expect(sd.currentSchool.value?.name_confirmed).toBe(true)
    vi.unstubAllGlobals()
  })

  it('confirmSchoolName surfaces the error and does not touch currentSchool on failure', async () => {
    const sd = await setup({}, 'school_admin')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        school: { school_id: 's1', school_name: 'My School', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 0, class_count: 0, student_count: 0, total_practice_hours: 0, created_at: '2025-01-01', name_confirmed: false },
        teachers: [],
        students: [],
      }),
    })))
    await sd.fetchSchools()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'update failed' }) })))
    const ok = await sd.confirmSchoolName('s1', 'New Name')
    expect(ok).toBe(false)
    expect(sd.error.value).toBeTruthy()
    vi.unstubAllGlobals()
    expect(sd.currentSchool.value?.school_name).toBe('My School')
  })

  it('sets error on fetch failure', async () => {
    const sd = await setup({}, 'school_admin')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await sd.fetchSchools()
    expect(sd.error.value).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
