import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

describe('useStudentsData', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function setup(responses: Record<string, any> = {}, role = 'school_admin') {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient(responses))
    const { useGodMode } = await import('./useGodMode')
    const gm = useGodMode()
    if (role === 'teacher') {
      gm.selectUser({
        user_id: 'u-t', learner_id: 'l-t', display_name: 'Teacher',
        educational_role: 'teacher', platform_role: null, school_id: 's1'
      })
    } else {
      gm.selectUser({
        user_id: 'u-a', learner_id: 'l-a', display_name: 'Admin',
        educational_role: 'school_admin', platform_role: null, school_id: 's1'
      })
    }
    const { useStudentsData } = await import('./useStudentsData')
    return useStudentsData()
  }

  it('fetches students for school_admin', async () => {
    const sd = await setup({
      classes: { data: [{ id: 'c1' }, { id: 'c2' }], error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'Alice', class_id: 'c1', class_name: 'Welsh', course_code: 'cym', seeds_completed: 10, legos_mastered: 20, total_practice_seconds: 1800, last_active_at: null, joined_class_at: '2025-01-01' },
        { student_user_id: 'su2', learner_id: 'sl2', student_name: 'Bob', class_id: 'c2', class_name: 'Spanish', course_code: 'spa', seeds_completed: 5, legos_mastered: 10, total_practice_seconds: 900, last_active_at: null, joined_class_at: '2025-01-05' },
      ], error: null },
    })
    await sd.fetchStudents()
    expect(sd.students.value).toHaveLength(2)
    expect(sd.totalStudents.value).toBe(2)
    expect(sd.avgSeedsCompleted.value).toBe(8) // (10+5)/2 = 7.5 → 8
    expect(sd.avgPracticeMinutes.value).toBe(23) // (30+15)/2 = 22.5 → 23
  })

  it('returns empty for teacher with no classes', async () => {
    const sd = await setup({
      classes: { data: [], error: null },
    }, 'teacher')
    await sd.fetchStudents()
    expect(sd.students.value).toEqual([])
    expect(sd.totalStudents.value).toBe(0)
  })

  it('activeToday counts students active today', async () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    const sd = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'A', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 60, last_active_at: '2025-06-15T10:00:00Z', joined_class_at: '2025-01-01' },
        { student_user_id: 'su2', learner_id: 'sl2', student_name: 'B', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 60, last_active_at: '2025-06-14T10:00:00Z', joined_class_at: '2025-01-01' },
        { student_user_id: 'su3', learner_id: 'sl3', student_name: 'C', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 60, last_active_at: null, joined_class_at: '2025-01-01' },
      ], error: null },
    })
    await sd.fetchStudents()
    expect(sd.activeToday.value).toBe(1)
  })

  it('activeThisWeek counts students active in last 7 days', async () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    const sd = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'A', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 60, last_active_at: '2025-06-15T10:00:00Z', joined_class_at: '2025-01-01' },
        { student_user_id: 'su2', learner_id: 'sl2', student_name: 'B', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 60, last_active_at: '2025-06-10T10:00:00Z', joined_class_at: '2025-01-01' },
        { student_user_id: 'su3', learner_id: 'sl3', student_name: 'C', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 60, last_active_at: '2025-06-01T10:00:00Z', joined_class_at: '2025-01-01' },
      ], error: null },
    })
    await sd.fetchStudents()
    expect(sd.activeThisWeek.value).toBe(2)
  })

  it('studentsByClass groups students correctly', async () => {
    const sd = await setup({
      classes: { data: [{ id: 'c1' }, { id: 'c2' }], error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'A', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 0, last_active_at: null, joined_class_at: '2025-01-01' },
        { student_user_id: 'su2', learner_id: 'sl2', student_name: 'B', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 0, last_active_at: null, joined_class_at: '2025-01-01' },
        { student_user_id: 'su3', learner_id: 'sl3', student_name: 'C', class_id: 'c2', class_name: 'Y', course_code: 'y', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 0, last_active_at: null, joined_class_at: '2025-01-01' },
      ], error: null },
    })
    await sd.fetchStudents()
    expect(sd.studentsByClass.value.get('c1')).toHaveLength(2)
    expect(sd.studentsByClass.value.get('c2')).toHaveLength(1)
  })

  it('converts practice seconds to minutes', async () => {
    const sd = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'A', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: 5432, last_active_at: null, joined_class_at: '2025-01-01' },
      ], error: null },
    })
    await sd.fetchStudents()
    expect(sd.students.value[0].total_practice_minutes).toBe(91) // Math.round(5432/60)
  })

  it('handles null total_practice_seconds', async () => {
    const sd = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      class_student_progress: { data: [
        { student_user_id: 'su1', learner_id: 'sl1', student_name: 'A', class_id: 'c1', class_name: 'X', course_code: 'x', seeds_completed: 1, legos_mastered: 1, total_practice_seconds: null, last_active_at: null, joined_class_at: '2025-01-01' },
      ], error: null },
    })
    await sd.fetchStudents()
    expect(sd.students.value[0].total_practice_minutes).toBe(0)
  })

  it('sets error on fetch failure', async () => {
    const sd = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      class_student_progress: { data: null, error: { message: 'DB down' } },
    })
    await sd.fetchStudents()
    expect(sd.error.value).toBeTruthy()
  })
})
