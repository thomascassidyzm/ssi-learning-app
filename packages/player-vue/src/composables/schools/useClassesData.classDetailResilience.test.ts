/**
 * The class-detail load path degrades PER PANEL (A-81, 2026-08-07).
 *
 * Production: a non-lead co-teacher (Bethan) opened her class on
 * saysomethingin.app. `class_student_progress` and `class_activity_stats` time
 * out (57014) under her RLS plan — verified at the DB level — and the whole
 * load aborted on the first failure. She was then shown three untrue things on
 * one screen: no roster, "no teachers are linked to this class yet" about a
 * class with two teachers, and a student invite link with the code missing.
 *
 * The class row and the class_teachers read both SUCCEED for her. So the
 * contract pinned here: one failing sub-fetch takes down its own panel and
 * nothing else, and a panel that failed says so rather than asserting zero.
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
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
    },
  } as any
}

async function setup(responses: Record<string, any>) {
  const { setSchoolsClient } = await import('./client')
  setSchoolsClient(createMockClient(responses))
  const { useSchoolContext } = await import('./useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u-bethan', learner_id: 'l-b', display_name: 'Bethan ZZ Cover',
    educational_role: 'teacher', platform_role: null, school_id: 's1',
  } as any
  const { useClassesData } = await import('./useClassesData')
  return useClassesData()
}

const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout' }

/** The class row Bethan's session really does get back, join code and all. */
const CLASS_ROW = {
  id: 'c1', class_name: 'ZZ Test — Year 7 Welsh', course_code: 'cym_s_for_eng',
  school_id: 's1', teacher_user_id: 'u-leader', student_join_code: 'RXQ-304',
  current_seed: 1, is_active: true, created_at: '2026-08-07',
}

/** Both teachers, which class_teachers really does return for her. */
const TEACHER_ROWS = [
  { class_id: 'c1', teacher_user_id: 'u-leader', is_lead: true },
  { class_id: 'c1', teacher_user_id: 'u-bethan', is_lead: false },
]

describe('fetchClassDetail — the co-teacher cascade', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    Object.keys(store).forEach(k => delete store[k])
  })

  it('keeps the teacher list and the join code when the roster view times out', async () => {
    const cd = await setup({
      classes: { data: CLASS_ROW, error: null },
      class_student_progress: { data: null, error: TIMEOUT },
      class_teachers: { data: TEACHER_ROWS, error: null },
    })

    await cd.fetchClassDetail('c1')

    // The panel that failed, and only that one, reports the failure.
    expect(cd.rosterError.value).toContain('statement timeout')
    // The two panels that did NOT fail are intact — this is the whole fix.
    expect(cd.classDetail.value?.teachers).toHaveLength(2)
    expect(cd.classDetail.value?.student_join_code).toBe('RXQ-304')
    expect(cd.teachersLoaded.value).toBe(true)
    expect(cd.teachersError.value).toBeNull()
    // A roster timeout is not a page-wide failure any more.
    expect(cd.error.value).toBeNull()
  })

  it('reports a FAILED teacher read instead of an empty teacher list', async () => {
    const cd = await setup({
      classes: { data: CLASS_ROW, error: null },
      class_student_progress: { data: [], error: null },
      class_teachers: { data: null, error: TIMEOUT },
    })

    await cd.fetchClassDetail('c1')

    expect(cd.teachersError.value).toContain('statement timeout')
    // loaded stays false, so the view can never render "no teachers yet".
    expect(cd.teachersLoaded.value).toBe(false)
    expect(cd.classDetail.value?.teachers).toEqual([])
  })

  it('marks the teacher read observed-and-empty when it genuinely returns zero', async () => {
    const cd = await setup({
      classes: { data: CLASS_ROW, error: null },
      class_student_progress: { data: [], error: null },
      class_teachers: { data: [], error: null },
    })

    await cd.fetchClassDetail('c1')

    expect(cd.teachersLoaded.value).toBe(true)
    expect(cd.teachersError.value).toBeNull()
    expect(cd.classDetail.value?.teachers).toEqual([])
  })

  it('still treats a missing class row as the page-wide failure it is', async () => {
    const cd = await setup({
      classes: { data: null, error: { message: 'No rows returned' } },
      class_student_progress: { data: [], error: null },
      class_teachers: { data: TEACHER_ROWS, error: null },
    })

    await cd.fetchClassDetail('c1')

    expect(cd.error.value).toBe('No rows returned')
  })

  it('clears a previous class\'s panel errors on the next load', async () => {
    const responses: Record<string, any> = {
      classes: { data: CLASS_ROW, error: null },
      class_student_progress: { data: null, error: TIMEOUT },
      class_teachers: { data: TEACHER_ROWS, error: null },
    }
    const cd = await setup(responses)
    await cd.fetchClassDetail('c1')
    expect(cd.rosterError.value).toBeTruthy()

    // Same session, the view recovers on a later refresh.
    responses.class_student_progress = { data: [], error: null }
    await cd.fetchClassDetail('c1')

    expect(cd.rosterError.value).toBeNull()
  })
})
