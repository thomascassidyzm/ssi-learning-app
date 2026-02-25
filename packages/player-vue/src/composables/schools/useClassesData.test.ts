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

describe('useClassesData', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })

  async function setup(responses: Record<string, any> = {}, role = 'teacher') {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient(responses))
    const { useGodMode } = await import('./useGodMode')
    const gm = useGodMode()
    if (role === 'teacher') {
      gm.selectUser({
        user_id: 'u-teacher', learner_id: 'l-t', display_name: 'Teacher',
        educational_role: 'teacher', platform_role: null, school_id: 's1'
      })
    } else if (role === 'school_admin') {
      gm.selectUser({
        user_id: 'u-admin', learner_id: 'l-a', display_name: 'Admin',
        educational_role: 'school_admin', platform_role: null, school_id: 's1'
      })
    }
    const { useClassesData } = await import('./useClassesData')
    return useClassesData()
  }

  // --- fetchClasses ---

  it('fetches classes for teacher (filters by teacher_user_id)', async () => {
    const cd = await setup({
      classes: { data: [
        { id: 'c1', class_name: 'Welsh 1A', course_code: 'cym_for_eng', school_id: 's1', teacher_user_id: 'u-teacher', student_join_code: 'ABC', current_seed: 15, is_active: true, created_at: '2025-01-01' },
      ], error: null },
      class_student_progress: { data: [
        { class_id: 'c1', seeds_completed: 20, total_practice_seconds: 1800 },
        { class_id: 'c1', seeds_completed: 30, total_practice_seconds: 3600 },
      ], error: null },
    })
    await cd.fetchClasses()
    expect(cd.classes.value).toHaveLength(1)
    expect(cd.classes.value[0].student_count).toBe(2)
    expect(cd.classes.value[0].avg_seeds_completed).toBe(25) // (20+30)/2
    expect(cd.classes.value[0].avg_practice_minutes).toBe(45) // (30+60)/2
  })

  it('returns empty when no classes found', async () => {
    const cd = await setup({
      classes: { data: [], error: null },
    })
    await cd.fetchClasses()
    expect(cd.classes.value).toEqual([])
  })

  it('does not fetch without selected user', async () => {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient({}))
    const { useGodMode } = await import('./useGodMode')
    useGodMode()
    const { useClassesData } = await import('./useClassesData')
    const cd = useClassesData()
    await cd.fetchClasses()
    expect(cd.classes.value).toEqual([])
  })

  // --- fetchClassDetail ---

  it('fetches class detail with student progress', async () => {
    const cd = await setup({
      classes: { data: {
        id: 'c1', class_name: 'Welsh 1A', course_code: 'cym_for_eng', school_id: 's1',
        teacher_user_id: 'u-teacher', student_join_code: 'ABC', current_seed: 15,
        is_active: true, created_at: '2025-01-01'
      }, error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'Bob', seeds_completed: 10, legos_mastered: 20, total_practice_seconds: 3600, last_active_at: '2025-02-01', joined_class_at: '2025-01-01' },
        { student_user_id: 'su2', learner_id: 'sl2', student_name: 'Alice', seeds_completed: 20, legos_mastered: 40, total_practice_seconds: 7200, last_active_at: '2025-02-02', joined_class_at: '2025-01-05' },
      ], error: null },
    })
    await cd.fetchClassDetail('c1')
    expect(cd.currentClass.value?.class_name).toBe('Welsh 1A')
    expect(cd.currentClass.value?.student_count).toBe(2)
    expect(cd.currentClass.value?.avg_seeds_completed).toBe(15) // (10+20)/2
    expect(cd.classStudents.value).toHaveLength(2)
    expect(cd.classStudents.value[0].total_practice_minutes).toBe(60) // 3600/60
  })

  // --- classDetail computed ---

  it('classDetail computed maps students correctly', async () => {
    const cd = await setup({
      classes: { data: {
        id: 'c1', class_name: 'Test', course_code: 'spa_for_eng', school_id: 's1',
        teacher_user_id: 'u-t', student_join_code: 'XYZ', current_seed: 5,
        is_active: true, created_at: '2025-01-01'
      }, error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'Carol', seeds_completed: 5, legos_mastered: 10, total_practice_seconds: 0, last_active_at: null, joined_class_at: '2025-01-01' },
      ], error: null },
    })
    await cd.fetchClassDetail('c1')
    const detail = cd.classDetail.value
    expect(detail?.students[0].user_id).toBe('su1')
    expect(detail?.students[0].display_name).toBe('Carol')
  })

  // --- getClassReport ---

  it('getClassReport returns report with demographics', async () => {
    const cd = await setup({
      class_activity_stats: { data: {
        class_id: 'c1', class_name: 'Welsh', total_cycles: 500, total_sessions: 20,
        total_practice_seconds: 36000, active_students: 10, avg_cycles_per_session: 25,
        active_days_last_7: 5, school_id: 's1', region_code: 'WALES', course_code: 'cym'
      }, error: null },
      demographic_cycle_averages: { data: [
        { level: 'school', group_id: 's1', avg_total_cycles: 400, avg_cycles_per_session: 20, class_count: 5 },
        { level: 'region', group_id: 'WALES', avg_total_cycles: 350, avg_cycles_per_session: 18, class_count: 20 },
      ], error: null },
    })
    const report = await cd.getClassReport('c1')
    expect(report?.class.total_cycles).toBe(500)
    expect(report?.schoolAvg?.avg_total_cycles).toBe(400)
    expect(report?.regionAvg?.avg_cycles_per_session).toBe(18)
  })

  it('getClassReport returns null on error', async () => {
    const cd = await setup({
      class_activity_stats: { data: null, error: { message: 'fail' } },
    })
    const report = await cd.getClassReport('c1')
    expect(report).toBeNull()
  })

  // --- session management ---

  it('startClassSession returns session id', async () => {
    const cd = await setup({
      class_sessions: { data: { id: 'sess-1' }, error: null },
    })
    const id = await cd.startClassSession('c1', 'u-teacher', 'S0001L01')
    expect(id).toBe('sess-1')
  })

  it('startClassSession returns null on error', async () => {
    const cd = await setup({
      class_sessions: { data: null, error: { message: 'insert failed' } },
    })
    const id = await cd.startClassSession('c1', 'u-teacher', 'S0001L01')
    expect(id).toBeNull()
  })

  it('endClassSession does not throw on error', async () => {
    const cd = await setup({
      class_sessions: { data: null, error: { message: 'update failed' } },
    })
    // Should not throw
    await cd.endClassSession('sess-1', 'S0010L03', 50, 1800)
  })

  it('getClassSessions returns empty on error', async () => {
    const cd = await setup({
      class_sessions: { data: null, error: { message: 'fail' } },
    })
    const sessions = await cd.getClassSessions('c1')
    expect(sessions).toEqual([])
  })

  // --- createClass ---

  it('createClass inserts and returns ClassInfo', async () => {
    const cd = await setup({
      classes: { data: {
        id: 'new-c', class_name: 'New Class', course_code: 'cym', school_id: 's1',
        teacher_user_id: 'u-teacher', student_join_code: 'JOIN1', current_seed: 1,
        is_active: true, created_at: '2025-03-01'
      }, error: null },
      invite_codes: { data: null, error: null },
    })
    const result = await cd.createClass({ class_name: 'New Class', course_code: 'cym', school_id: 's1' })
    expect(result?.class_name).toBe('New Class')
    expect(result?.student_count).toBe(0)
  })

  // --- totalStudentsInClasses ---

  it('totalStudentsInClasses sums all class student_counts', async () => {
    const cd = await setup({
      classes: { data: [
        { id: 'c1', class_name: 'A', course_code: 'x', school_id: 's1', teacher_user_id: 'u-teacher', student_join_code: '', current_seed: 1, is_active: true, created_at: '' },
        { id: 'c2', class_name: 'B', course_code: 'x', school_id: 's1', teacher_user_id: 'u-teacher', student_join_code: '', current_seed: 1, is_active: true, created_at: '' },
      ], error: null },
      class_student_progress: { data: [
        { class_id: 'c1', seeds_completed: 0, total_practice_seconds: 0 },
        { class_id: 'c1', seeds_completed: 0, total_practice_seconds: 0 },
        { class_id: 'c2', seeds_completed: 0, total_practice_seconds: 0 },
      ], error: null },
    })
    await cd.fetchClasses()
    expect(cd.totalStudentsInClasses.value).toBe(3)
  })
})
