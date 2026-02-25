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

describe('useTeachersData', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })

  async function setup(responses: Record<string, any> = {}) {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient(responses))
    const { useGodMode } = await import('./useGodMode')
    const gm = useGodMode()
    gm.selectUser({
      user_id: 'u-admin', learner_id: 'l-admin', display_name: 'Admin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1'
    })
    const { useTeachersData } = await import('./useTeachersData')
    return useTeachersData()
  }

  it('returns empty array when no teacher tags found', async () => {
    const td = await setup({
      user_tags: { data: [], error: null },
    })
    await td.fetchTeachers()
    expect(td.teachers.value).toEqual([])
  })

  it('aggregates multi-step teacher data correctly', async () => {
    const td = await setup({
      user_tags: { data: [
        { user_id: 'ut1', added_at: '2025-01-01' },
        { user_id: 'ut2', added_at: '2025-02-01' },
      ], error: null },
      learners: { data: [
        { id: 'l1', user_id: 'ut1', display_name: 'Zara Teacher' },
        { id: 'l2', user_id: 'ut2', display_name: 'Alice Teacher' },
      ], error: null },
      classes: { data: [
        { id: 'c1', teacher_user_id: 'ut1' },
        { id: 'c2', teacher_user_id: 'ut1' },
        { id: 'c3', teacher_user_id: 'ut2' },
      ], error: null },
      class_student_progress: { data: [
        { class_id: 'c1', teacher_user_id: 'ut1', total_practice_seconds: 3600 },
        { class_id: 'c1', teacher_user_id: 'ut1', total_practice_seconds: 7200 },
        { class_id: 'c3', teacher_user_id: 'ut2', total_practice_seconds: 1800 },
      ], error: null },
    })
    await td.fetchTeachers()

    expect(td.teachers.value).toHaveLength(2)
    // Should be sorted alphabetically
    expect(td.teachers.value[0].display_name).toBe('Alice Teacher')
    expect(td.teachers.value[1].display_name).toBe('Zara Teacher')

    const zara = td.teachers.value[1]
    expect(zara.class_count).toBe(2)
    expect(zara.student_count).toBe(2)
    // (3600 + 7200) / 3600 = 3.0 hours
    expect(zara.total_practice_hours).toBe(3)
  })

  it('rounds practice hours to 1 decimal', async () => {
    const td = await setup({
      user_tags: { data: [{ user_id: 'ut1', added_at: '2025-01-01' }], error: null },
      learners: { data: [{ id: 'l1', user_id: 'ut1', display_name: 'Test' }], error: null },
      classes: { data: [{ id: 'c1', teacher_user_id: 'ut1' }], error: null },
      class_student_progress: { data: [
        { class_id: 'c1', teacher_user_id: 'ut1', total_practice_seconds: 5432 },
      ], error: null },
    })
    await td.fetchTeachers()
    // 5432 / 3600 = 1.5088... → rounded to 1.5
    expect(td.teachers.value[0].total_practice_hours).toBe(1.5)
  })

  it('handles null total_practice_seconds', async () => {
    const td = await setup({
      user_tags: { data: [{ user_id: 'ut1', added_at: '2025-01-01' }], error: null },
      learners: { data: [{ id: 'l1', user_id: 'ut1', display_name: 'Test' }], error: null },
      classes: { data: [{ id: 'c1', teacher_user_id: 'ut1' }], error: null },
      class_student_progress: { data: [
        { class_id: 'c1', teacher_user_id: 'ut1', total_practice_seconds: null },
      ], error: null },
    })
    await td.fetchTeachers()
    expect(td.teachers.value[0].total_practice_hours).toBe(0)
  })

  it('does not fetch without school id', async () => {
    const { setSchoolsClient } = await import('./client')
    const mockClient = createMockClient({})
    setSchoolsClient(mockClient)
    const { useGodMode } = await import('./useGodMode')
    useGodMode() // no user selected
    const { useTeachersData } = await import('./useTeachersData')
    const td = useTeachersData()
    await td.fetchTeachers()
    expect(td.teachers.value).toEqual([])
  })

  it('sets error on fetch failure', async () => {
    const td = await setup({
      user_tags: { data: null, error: { message: 'Network error' } },
    })
    await td.fetchTeachers()
    expect(td.error.value).toBeTruthy()
  })

  it('fetches with explicit schoolId parameter', async () => {
    const td = await setup({
      user_tags: { data: [{ user_id: 'ut1', added_at: '2025-01-01' }], error: null },
      learners: { data: [{ id: 'l1', user_id: 'ut1', display_name: 'Test' }], error: null },
      classes: { data: [], error: null },
      class_student_progress: { data: [], error: null },
    })
    await td.fetchTeachers('explicit-school-id')
    expect(td.teachers.value).toHaveLength(1)
  })
})
