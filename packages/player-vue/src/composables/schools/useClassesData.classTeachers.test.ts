/**
 * The co-teacher seam of useClassesData (A-74, 2026-08-06).
 *
 * Two things this pins:
 *   1. `classDetail` — the shape ClassDetail.vue actually consumes — CARRIES
 *      the class's teacher set. fetchClassDetail always populated
 *      ClassInfo.teachers from the class_teachers view; the computed dropped
 *      it on the way through, which is why no view could render "who teaches
 *      this class" despite the data model being plural since 2026-06-13.
 *   2. The teacher↔class writes return the server's REAL reason on failure.
 *      A bare boolean left the panel with nothing honest to say, which is one
 *      step from the false-"Saved" class this codebase bans.
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

function createMockClient(responses: Record<string, any>, token: string | null = 'tok') {
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
      getSession: vi.fn(async () => ({
        data: { session: token ? { access_token: token } : null },
      })),
    },
  } as any
}

async function setup(responses: Record<string, any> = {}, token: string | null = 'tok') {
  const { setSchoolsClient } = await import('./client')
  setSchoolsClient(createMockClient(responses, token))
  const { useSchoolContext } = await import('./useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u-teacher', learner_id: 'l-t', display_name: 'Teacher',
    educational_role: 'teacher', platform_role: null, school_id: 's1',
  } as any
  const { useClassesData } = await import('./useClassesData')
  return useClassesData()
}

describe('useClassesData — co-teachers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    Object.keys(store).forEach(k => delete store[k])
  })

  it('classDetail carries the class\'s teacher set through to the view', async () => {
    const cd = await setup({
      classes: { data: {
        id: 'c1', class_name: 'Welsh 1A', course_code: 'cym_for_eng', school_id: 's1',
        teacher_user_id: 'u-teacher', student_join_code: 'ABC', current_seed: 15,
        is_active: true, created_at: '2025-01-01',
      }, error: null },
      class_student_progress: { data: [], error: null },
      class_teachers: { data: [
        { class_id: 'c1', teacher_user_id: 'u-teacher', is_lead: true },
        { class_id: 'c1', teacher_user_id: 'u-supply', is_lead: false },
      ], error: null },
    })

    await cd.fetchClassDetail('c1')

    expect(cd.currentClass.value?.teachers).toHaveLength(2)
    // The computed the view consumes must not drop them.
    expect(cd.classDetail.value?.teachers).toEqual([
      { user_id: 'u-teacher', is_lead: true },
      { user_id: 'u-supply', is_lead: false },
    ])
  })

  it('addClassTeacher returns the server\'s reason when the write is refused', async () => {
    const cd = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Not authorized to manage teachers for this class' }),
    })) as any)

    const result = await cd.addClassTeacher('c1', 'u-supply')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Not authorized to manage teachers for this class')
  })

  it('removeClassTeacher reports success truthfully', async () => {
    const cd = await setup()
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock as any)

    const result = await cd.removeClassTeacher('c1', 'u-supply')

    expect(result).toEqual({ ok: true, error: null })
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/class-teachers', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ class_id: 'c1', action: 'remove', target_user_id: 'u-supply', set_lead: undefined }),
    }))
  })

  it('mints a CLASS-scoped co-teacher link and never sends a school of its own', async () => {
    const cd = await setup()
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ code: 'SUPPLY1' }) }))
    vi.stubGlobal('fetch', fetchMock as any)

    const result = await cd.createCoTeacherLink('c1')

    expect(result).toEqual({ ok: true, code: 'SUPPLY1', error: null })
    // The school is SERVER-derived from the class — sending one from the
    // client is exactly the `SCHOOL:null` garbage that derivation prevents.
    expect(fetchMock).toHaveBeenCalledWith('/api/invite/create', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code_type: 'teacher', grants_class_id: 'c1' }),
    }))
  })

  it('reports the server\'s refusal of a co-teacher link instead of a dead link', async () => {
    const cd = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Only a teacher of this class or its school admin can create co-teacher codes for this class' }),
    })) as any)

    const result = await cd.createCoTeacherLink('c1')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ error: expect.stringContaining('Only a teacher of this class') })
  })

  it('says so plainly when there is no session, rather than reporting a phantom success', async () => {
    const cd = await setup({}, null)
    const result = await cd.addClassTeacher('c1', 'u-supply', { lead: true })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('You are not signed in.')
  })
})
