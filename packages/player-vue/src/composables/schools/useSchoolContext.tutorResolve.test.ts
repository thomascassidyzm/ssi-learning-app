import { describe, it, expect, beforeEach } from 'vitest'

// THE-MODEL §1.3/I5 persona-gating end-to-end: exercises the REAL
// resolveUser() query path (via loadFromAuth) for the four personas —
// school teacher w/ class, school teacher w/o class, groupless tutor w/
// class, groupless tutor w/o class — through a fake chainable Supabase
// client, the same shape a live session would produce.

let DB: Record<string, any[]>

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    is: (col: string, val: unknown) => { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return builder },
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(
      rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    ),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  }
  return builder
}

function fakeClient() {
  return { from: (table: string) => makeChainable(table) } as any
}

describe('useSchoolContext — resolveUser persona gating (via loadFromAuth)', () => {
  beforeEach(() => {
    DB = {
      learners: [],
      user_tags: [],
      schools: [],
      teachers: [],
      govt_admins: [],
      groups: [],
    }
  })

  it('school teacher WITH a school tag: school_id resolves, platform gate from schools row', async () => {
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.clear()
    DB.learners = [{ id: 'l1', user_id: 'auth-teacher', display_name: 'Teacher', educational_role: 'teacher', platform_role: null }]
    DB.user_tags = [{ user_id: 'auth-teacher', tag_value: 'SCHOOL:s1', tag_type: 'school', removed_at: null, added_at: '2025-01-01' }]
    DB.schools = [{ id: 's1', school_name: 'Sunrise', region_code: 'GB', platform_status: 'active', platform_expires_at: null }]

    await ctx.loadFromAuth('auth-teacher', fakeClient())

    expect(ctx.currentUser.value?.school_id).toBe('s1')
    expect(ctx.currentUser.value?.platform_status).toBe('active')
    expect(ctx.isTeacher.value).toBe(true)
  })

  it('groupless tutor WITH a class: resolveUser leaves school_id unset (the tutor signature), reads the platform gate off the teachers row', async () => {
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.clear()
    DB.learners = [{ id: 'l2', user_id: 'auth-tutor', display_name: 'Tutor', educational_role: 'tutor', platform_role: null }]
    // No user_tags row, no schools row admin_user_id match — a real groupless tutor.
    DB.teachers = [{ learner_id: 'l2', platform_status: 'trial', platform_expires_at: '2099-01-01T00:00:00Z' }]

    await ctx.loadFromAuth('auth-tutor', fakeClient())

    expect(ctx.currentUser.value?.school_id).toBeUndefined()
    expect(ctx.currentUser.value?.platform_status).toBe('trial')
    // THE-MODEL I5: a tutor is a teacher for shell/capability purposes.
    expect(ctx.isTeacher.value).toBe(true)
    expect(ctx.isSchoolStaff.value).toBe(true)
    expect(ctx.platformActive.value).toBe(true) // future expiry, still active
  })

  it('groupless tutor WITHOUT a teachers row (pre-provision race): resolves cleanly, fails open on the platform gate', async () => {
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.clear()
    DB.learners = [{ id: 'l3', user_id: 'auth-tutor2', display_name: 'Tutor', educational_role: 'tutor', platform_role: null }]

    await ctx.loadFromAuth('auth-tutor2', fakeClient())

    expect(ctx.currentUser.value?.school_id).toBeUndefined()
    expect(ctx.currentUser.value?.educational_role).toBe('tutor')
    expect(ctx.isTeacher.value).toBe(true)
    expect(ctx.platformActive.value).toBe(true) // null status fails open
  })

  it('a school-employed teacher never has their real school_id clobbered by the tutor branch merge', async () => {
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.clear()
    DB.learners = [{ id: 'l4', user_id: 'auth-teacher2', display_name: 'Teacher', educational_role: 'teacher', platform_role: null }]
    DB.user_tags = [{ user_id: 'auth-teacher2', tag_value: 'SCHOOL:s2', tag_type: 'school', removed_at: null, added_at: '2025-01-01' }]
    DB.schools = [{ id: 's2', school_name: 'Oak', region_code: 'GB', platform_status: 'active', platform_expires_at: null }]
    DB.teachers = [{ learner_id: 'l4', platform_status: 'expired', platform_expires_at: null }]

    await ctx.loadFromAuth('auth-teacher2', fakeClient())

    // School row wins for a staffed teacher — the teachers-row platform
    // fields only take precedence when there's NO school (see resolveUser).
    expect(ctx.currentUser.value?.school_id).toBe('s2')
    expect(ctx.currentUser.value?.platform_status).toBe('active')
  })
})
