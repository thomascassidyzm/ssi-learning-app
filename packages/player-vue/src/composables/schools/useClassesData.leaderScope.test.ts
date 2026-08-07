/**
 * A leader who also teaches sees the UNION of both roles.
 *
 * Tom, 2026-08-07: "as a school leader … I need to be able to assign teachers
 * to any class." The first thing a leader needs is to SEE the classes. The
 * live cause of his empty Classes tab was RLS (20260807c/d), but the client
 * had the same shape of flaw waiting: fetchClasses branched to ONE role and
 * short-circuited on it, so anyone who is both a leader and a teacher saw one
 * half of their world. A supply teacher assigned across schools is exactly
 * that person.
 *
 * The old code declared a single scope and ran assertScope() twice — an
 * INTERSECTION — so a class taught outside the leader's own school was
 * reported as an [RLS_VIOLATION] and dropped (thrown, under test). These
 * specs fail on that behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn(() => {}),
    clear: vi.fn(() => {}),
  },
  writable: true,
})

// myTaughtClassIds owns its own two reads; stub it so a spec can say exactly
// which classes this person teaches, independent of the classes fixture.
const taught = { ids: [] as string[] }
vi.mock('./classTeacherScope', () => ({
  myTaughtClassIds: vi.fn(async () => taught.ids),
  teachersByClassId: vi.fn(async () => new Map()),
  teachersByClassIdResult: vi.fn(async () => ({ map: new Map(), error: null })),
}))

function createMockClient(responses: Record<string, any>) {
  let currentTable = ''
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        const resp = responses[currentTable] || { data: [], error: null }
        return (resolve: any) => resolve(resp)
      }
      return vi.fn(() => new Proxy({}, handler))
    },
  }
  return {
    from: vi.fn((table: string) => {
      currentTable = table
      return new Proxy({}, handler)
    }),
  } as any
}

const cls = (id: string, schoolId: string | null) => ({
  id, class_name: id, course_code: 'cym_for_eng', school_id: schoolId,
  teacher_user_id: 'someone-else', student_join_code: 'ABC', current_seed: 1,
  is_active: true, created_at: '2026-01-01',
})

describe('useClassesData — a leader who also teaches', () => {
  beforeEach(() => {
    vi.resetModules()
    taught.ids = []
  })

  async function setup(responses: Record<string, any>, user: Record<string, unknown>) {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient(responses))
    const { useSchoolContext } = await import('./useSchoolContext')
    useSchoolContext().currentUser.value = user as any
    const { useClassesData } = await import('./useClassesData')
    return useClassesData()
  }

  const leader = {
    user_id: 'u-leader', learner_id: 'l-leader', display_name: 'Harbour Leader',
    educational_role: 'school_admin', platform_role: null, school_id: 's1',
  }

  it('keeps a class taught OUTSIDE the leader\'s own school — union, not intersection', async () => {
    taught.ids = ['c-supply']
    const cd = await setup({
      classes: { data: [cls('c-own', 's1'), cls('c-supply', 's2')], error: null },
      class_student_progress: { data: [], error: null },
    }, leader)

    await cd.fetchClasses()

    // Old behaviour: the school-scope assertScope threw on c-supply.
    expect(cd.classes.value.map(c => c.id).sort()).toEqual(['c-own', 'c-supply'])
  })

  it('a leader with no classes of her own still sees her school\'s classes', async () => {
    taught.ids = []
    const cd = await setup({
      classes: { data: [cls('c-own', 's1')], error: null },
      class_student_progress: { data: [], error: null },
    }, leader)

    await cd.fetchClasses()

    expect(cd.classes.value.map(c => c.id)).toEqual(['c-own'])
    expect(cd.classesLoaded.value).toBe(true)
  })

  it('still refuses a class from a school she neither leads nor teaches in', async () => {
    taught.ids = []
    const cd = await setup({
      classes: { data: [cls('c-own', 's1'), cls('c-alien', 's9')], error: null },
      class_student_progress: { data: [], error: null },
    }, leader)

    // The rlsGuard tripwire throws in test/dev rather than filtering quietly.
    await cd.fetchClasses()
    expect(cd.error.value).toMatch(/RLS_VIOLATION/)
  })

  it('classesLoaded stays false when the read fails — "No classes yet" may not speak', async () => {
    taught.ids = []
    const cd = await setup({
      classes: { data: null, error: { message: 'network down' } },
    }, leader)

    await cd.fetchClasses()

    expect(cd.classesLoaded.value).toBe(false)
    expect(cd.error.value).toBeTruthy()
  })

  it('a teacher with no classes resolves to a clean, OBSERVED empty', async () => {
    taught.ids = []
    const cd = await setup({ classes: { data: [], error: null } }, {
      user_id: 'u-t', learner_id: 'l-t', display_name: 'T',
      educational_role: 'teacher', platform_role: null, school_id: 's1',
    })

    await cd.fetchClasses()

    expect(cd.classes.value).toEqual([])
    expect(cd.classesLoaded.value).toBe(true)
  })
})
