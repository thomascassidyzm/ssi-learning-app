import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock localStorage (chains via useSchoolContext/client can touch it).
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

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** Chainable Supabase mock; per-table response is produced by a resolver fn. */
function createControlledClient(resolvers: Record<string, () => Promise<any>>) {
  let currentTable = ''
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        const resolver = resolvers[currentTable] || (() => Promise.resolve({ data: [], error: null }))
        const p = resolver()
        return (resolve: any, reject: any) => p.then(resolve, reject)
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

// Regression for the SCHOOL LEADER context-race crash (useSchoolData.ts:300,
// "Cannot read properties of null (reading 'school_id')"): fetchSchools()
// re-read the SHARED, module-level currentUser ref across its awaits. When an
// admin read-view drill-in (AdminSchoolsContainer) nulled that ref mid-flight
// on teardown, the next `selectedUser.value.school_id` threw and the
// dashboard showed "Couldn't refresh". fetchSchools now snapshots the scope
// once; nulling the context mid-request can no longer crash it.
describe('useSchoolData — admin read-view: context nulled mid-flight never crashes', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
  })

  async function setupSchoolAdminPersona() {
    const { setSchoolsClient } = await import('./client')
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'lissy-uid',
      learner_id: 'lissy-lid',
      display_name: 'Lissy Thomas',
      educational_role: 'school_admin',
      platform_role: null,
      school_id: 'sch-1',
      school_name: "St Mary's",
      _scopeSource: 'admin-view',
    } as any
    return { ctx, setSchoolsClient, useSchoolContext }
  }

  it('resolves the school row for a school-admin persona (school_id carried through)', async () => {
    const { ctx, setSchoolsClient } = await setupSchoolAdminPersona()
    const client = createControlledClient({
      school_summary: async () => ({ data: { school_id: 'sch-1', school_name: "St Mary's", region_code: 'IN', group_id: 'g1', admin_user_id: 'lissy-uid', teacher_count: 3, class_count: 2, student_count: 38, total_practice_hours: 131.3, created_at: '2025-01-01' }, error: null }),
      schools: async () => ({ data: { teacher_join_code: 'TCH', admin_join_code: 'ADM' }, error: null }),
      class_activity_stats: async () => ({ data: [{ school_id: 'sch-1', active_days_last_7: 4 }], error: null }),
    })
    setSchoolsClient(client)

    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()
    await sd.fetchSchools()

    expect(sd.error.value).toBeNull()
    expect(sd.currentSchool.value?.id).toBe('sch-1')
    expect(sd.currentSchool.value?.student_count).toBe(38)
    void ctx
  })

  it('does not throw when currentUser is nulled while the school_summary read is in flight', async () => {
    const { ctx, setSchoolsClient } = await setupSchoolAdminPersona()
    const gate = deferred<any>()
    const client = createControlledClient({
      school_summary: async () => {
        await gate.promise // hold the read open so we can null the context under it
        return { data: { school_id: 'sch-1', school_name: "St Mary's", region_code: 'IN', group_id: 'g1', admin_user_id: 'lissy-uid', teacher_count: 3, class_count: 2, student_count: 38, total_practice_hours: 131.3, created_at: '2025-01-01' }, error: null }
      },
      schools: async () => ({ data: { teacher_join_code: 'TCH', admin_join_code: 'ADM' }, error: null }),
      class_activity_stats: async () => ({ data: [], error: null }),
    })
    setSchoolsClient(client)

    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()

    const inFlight = sd.fetchSchools()
    // Simulate an admin read-view teardown clearing the shared context
    // WHILE the read above is still pending.
    ctx.currentUser.value = null
    gate.resolve(null)

    await expect(inFlight).resolves.toBeUndefined()
    // The snapshot let the call complete against the original persona.
    expect(sd.error.value).toBeNull()
    expect(sd.currentSchool.value?.id).toBe('sch-1')
  })
})
