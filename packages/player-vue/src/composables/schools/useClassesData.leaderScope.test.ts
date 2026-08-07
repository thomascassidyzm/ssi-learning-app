/**
 * The leader's Classes tab — regression cover for the empty-Classes-tab bug.
 *
 * Tom, staging, 2026-08-07, signed in as "Harbour Leader" (School Admin at
 * Harbour View School): the Dashboard tab listed the school's three classes
 * while the Classes tab, same user same school, said "0 classes" and rendered
 * the first-run "No classes yet — Create your first class" empty state. That
 * locked him out of class detail, which is the only place a teacher can be
 * attached to a class.
 *
 * The ROOT CAUSE was in the database, not here: classes_select's admin
 * disjunct is is_school_admin_of(school_id), and that function only recognised
 * the schools.admin_user_id POINTER, never the service-role-written school
 * ADMIN TAG that every admin after the founding one holds. Her browser read
 * came back silently empty. Fixed by migrations 20260807c/20260807d and proved
 * live (supabase/secfix-toolkit/verify_school_admin_tag_parity.cjs).
 *
 * These tests are the CLIENT-side half of that guard: they pin the branch
 * selection in fetchClasses, so a future refactor cannot re-create the same
 * symptom from the other end — by routing a leader down a path that yields
 * nothing. In particular fetchClasses' FIRST branch (isTeacher) returns EARLY
 * with classes = [] when the caller teaches no classes, and a leader must
 * never fall into it.
 */
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

/**
 * Mock client that RECORDS the filters applied, so a test can assert which
 * scope branch ran — the thing that actually broke — rather than only the rows
 * that came back.
 */
function createRecordingClient(responses: Record<string, any>) {
  const calls: Array<{ table: string; op: string; args: any[] }> = []
  let currentTable = ''
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        const resp = responses[currentTable] || { data: [], error: null }
        return (resolve: any) => resolve(resp)
      }
      return vi.fn((...args: any[]) => {
        calls.push({ table: currentTable, op: String(prop), args })
        return new Proxy({}, handler)
      })
    },
  }
  const client = {
    from: vi.fn((table: string) => {
      currentTable = table
      return new Proxy({}, handler)
    }),
    calls,
  } as any
  return client
}

const SCHOOL_CLASSES = [
  { id: 'c-6b', class_name: 'Grade 6B', course_code: 'eng_for_hin', school_id: 's1', teacher_user_id: 'u-anjali', student_join_code: 'A1', current_seed: 40, is_active: true, created_at: '2026-01-01' },
  { id: 'c-7a', class_name: 'Grade 7A', course_code: 'eng_for_hin', school_id: 's1', teacher_user_id: 'u-anjali', student_join_code: 'A2', current_seed: 40, is_active: true, created_at: '2026-01-01' },
  { id: 'c-y7', class_name: 'Y7 English', course_code: 'eng_for_hin', school_id: 's1', teacher_user_id: 'u-vizag', student_join_code: 'A3', current_seed: 20, is_active: true, created_at: '2026-01-01' },
]

describe('useClassesData — the leader\'s Classes tab', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })

  async function setupLeader(responses: Record<string, any>) {
    const { setSchoolsClient } = await import('./client')
    const client = createRecordingClient(responses)
    setSchoolsClient(client)
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    // Harbour Leader: a school admin who is NOT her school's admin_user_id
    // pointer and who leads no class of her own.
    ctx.currentUser.value = {
      user_id: 'u-harbour-leader',
      learner_id: 'l-hl',
      display_name: 'Harbour Leader',
      educational_role: 'school_admin',
      platform_role: null,
      school_id: 's1',
    }
    const { useClassesData } = await import('./useClassesData')
    return { cd: useClassesData(), client }
  }

  it('a school admin who teaches NO classes still sees every active class in her school', async () => {
    const { cd } = await setupLeader({
      classes: { data: SCHOOL_CLASSES, error: null },
      class_student_progress: { data: [
        { class_id: 'c-6b', seeds_completed: 40, total_practice_seconds: 1800 },
        { class_id: 'c-7a', seeds_completed: 40, total_practice_seconds: 1800 },
      ], error: null },
    })

    await cd.fetchClasses()

    // The symptom Tom saw was LENGTH 0 here, with the view then rendering
    // "No classes yet — Create your first class".
    expect(cd.classes.value).toHaveLength(3)
    expect(cd.classes.value.map(c => c.class_name).sort())
      .toEqual(['Grade 6B', 'Grade 7A', 'Y7 English'])
  })

  it('scopes by school_id — never by class membership, which would empty the tab', async () => {
    const { cd, client } = await setupLeader({
      classes: { data: SCHOOL_CLASSES, error: null },
      class_student_progress: { data: [], error: null },
    })

    await cd.fetchClasses()

    const classQueryCalls = client.calls.filter((c: any) => c.table === 'classes')
    // The school branch: .eq('school_id', 's1')
    expect(classQueryCalls).toContainEqual(
      expect.objectContaining({ op: 'eq', args: ['school_id', 's1'] }),
    )
    // The teacher branch would have narrowed to a class-id list. If a refactor
    // ever routes a leader through myTaughtClassIds, she teaches nothing, the
    // branch returns early with [], and the empty Classes tab is back.
    expect(classQueryCalls.some((c: any) => c.op === 'in' && c.args[0] === 'id')).toBe(false)
    expect(cd.classes.value).toHaveLength(3)
  })

  it('reports a failed read as an error rather than as an empty school', async () => {
    // An empty state is an assertion about the world. When the read did not
    // come back clean, the leader must be told it failed — not shown the
    // first-run "create your first class" card for a school full of classes.
    const { cd } = await setupLeader({
      classes: { data: null, error: { message: 'permission denied for table classes' } },
    })

    await cd.fetchClasses()

    expect(cd.classes.value).toEqual([])
    expect(cd.error.value).toBe('permission denied for table classes')
  })
})
