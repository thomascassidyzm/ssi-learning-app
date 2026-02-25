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
    })
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

    const { useGodMode } = await import('./useGodMode')
    const gm = useGodMode()

    // Set up a user matching the role
    if (role === 'govt_admin') {
      gm.selectUser({
        user_id: 'u1', learner_id: 'l1', display_name: 'Gov',
        educational_role: 'govt_admin', platform_role: null,
        region_code: 'WALES'
      })
    } else if (role === 'school_admin') {
      gm.selectUser({
        user_id: 'u2', learner_id: 'l2', display_name: 'Admin',
        educational_role: 'school_admin', platform_role: null,
        school_id: 's1'
      })
    } else if (role === 'teacher') {
      gm.selectUser({
        user_id: 'u3', learner_id: 'l3', display_name: 'Teacher',
        educational_role: 'teacher', platform_role: null,
        school_id: 's1'
      })
    }

    const { useSchoolData } = await import('./useSchoolData')
    return useSchoolData()
  }

  it('fetches all schools for govt_admin', async () => {
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
    expect(sd.regionSummary.value?.student_count).toBe(80)
  })

  it('fetches single school for school_admin', async () => {
    const sd = await setup({
      school_summary: {
        data: { school_id: 's1', school_name: 'My School', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 4, class_count: 2, student_count: 25, total_practice_hours: 50, created_at: '2025-01-01' },
        error: null,
      },
      schools: {
        data: { teacher_join_code: 'ABC123' },
        error: null,
      },
    }, 'school_admin')

    await sd.fetchSchools()
    expect(sd.currentSchool.value?.school_name).toBe('My School')
    expect(sd.currentSchool.value?.teacher_join_code).toBe('ABC123')
    expect(sd.schools.value).toHaveLength(1)
  })

  it('fetches single school for teacher', async () => {
    const sd = await setup({
      school_summary: {
        data: { school_id: 's1', school_name: 'My School', region_code: 'WALES', admin_user_id: 'u2', teacher_count: 4, class_count: 2, student_count: 25, total_practice_hours: 50, created_at: '2025-01-01' },
        error: null,
      },
      schools: {
        data: { teacher_join_code: 'XYZ789' },
        error: null,
      },
    }, 'teacher')

    await sd.fetchSchools()
    expect(sd.currentSchool.value?.school_name).toBe('My School')
  })

  // --- drill-down ---

  it('drill-down: selectSchoolToView and clearViewingSchool', async () => {
    const sd = await setup({}, 'govt_admin')
    const school = {
      id: 's1', school_name: 'Test', region_code: 'WALES', admin_user_id: 'u1',
      teacher_join_code: '', teacher_count: 1, class_count: 1, student_count: 10,
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
      teacher_join_code: '', teacher_count: 1, class_count: 1, student_count: 42,
      total_practice_hours: 20, created_at: '2025-01-01',
    }
    sd.selectSchoolToView(school)
    expect(sd.totalStudents.value).toBe(42)
  })

  it('totalStudents sums schools when no drill-down and no region summary', async () => {
    const sd = await setup({}, 'govt_admin')
    sd.schools.value = [
      { id: 's1', school_name: 'A', region_code: null, admin_user_id: 'u1', teacher_join_code: '', teacher_count: 1, class_count: 1, student_count: 10, total_practice_hours: 5, created_at: '' },
      { id: 's2', school_name: 'B', region_code: null, admin_user_id: 'u2', teacher_join_code: '', teacher_count: 1, class_count: 1, student_count: 20, total_practice_hours: 10, created_at: '' },
    ]
    sd.regionSummary.value = null
    expect(sd.totalStudents.value).toBe(30)
  })

  it('totalPracticeHours uses regionSummary when available', async () => {
    const sd = await setup({}, 'govt_admin')
    sd.regionSummary.value = { region_code: 'W', region_name: 'Wales', school_count: 1, teacher_count: 1, student_count: 1, total_practice_hours: 999 }
    expect(sd.totalPracticeHours.value).toBe(999)
  })

  it('does not fetch if no selected user', async () => {
    const { setSchoolsClient } = await import('./client')
    const mockClient = createMockClient({})
    setSchoolsClient(mockClient)
    const { useGodMode } = await import('./useGodMode')
    useGodMode() // no user selected
    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()
    await sd.fetchSchools()
    expect(mockClient.from).not.toHaveBeenCalled()
  })

  it('sets error on fetch failure', async () => {
    const sd = await setup({
      school_summary: { data: null, error: { message: 'DB error' } },
    }, 'school_admin')
    await sd.fetchSchools()
    expect(sd.error.value).toBeTruthy()
  })
})
