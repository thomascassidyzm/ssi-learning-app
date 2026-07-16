import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock localStorage (useSchoolData doesn't touch it directly, but client.ts /
// useSchoolContext chains sometimes do via other composables in real use).
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

/**
 * A chainable Supabase mock where the RESPONSE for a given table is produced
 * by a function (called once per `.from(table)` invocation, in call order),
 * not a static value — lets a test control exactly when/in-what-order two
 * overlapping fetchSchools() calls resolve their DB round trips.
 */
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

describe('useSchoolData — overlapping fetchSchools() calls never let a stale response win', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
  })

  it('a slower-to-resolve OLDER call never clobbers a faster NEWER call\'s result — govt admin "All schools" list', async () => {
    const { setSchoolsClient } = await import('./client')
    const { useSchoolContext } = await import('./useSchoolContext')
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Gov',
      educational_role: 'govt_admin', platform_role: null, region_code: 'WALES',
    } as any

    // school_summary: call #0 (the FIRST, older fetchSchools()) reports
    // 'Awaiting admin' data; call #1 (the SECOND, newer fetchSchools())
    // reports the correct, current claimed state. Both resolve immediately —
    // only the LAST round trip (class_activity_stats) is deferred, so we can
    // control which call's write actually lands last.
    let ssCall = -1
    const schoolSummaryByCall = [
      [{ school_id: 's1', school_name: 'Angharad 001', region_code: 'WALES', admin_user_id: null, has_admin: false, teacher_count: 0, class_count: 0, student_count: 0, total_practice_hours: 0, created_at: '2025-01-01' }],
      [{ school_id: 's1', school_name: 'Angharad 001', region_code: 'WALES', admin_user_id: 'admin-1', has_admin: true, teacher_count: 2, class_count: 1, student_count: 12, total_practice_hours: 4, created_at: '2025-01-01' }],
    ]

    let activeDaysCall = -1
    const activeDaysDeferreds = [deferred<any>(), deferred<any>()]

    const client = createControlledClient({
      school_summary: async () => {
        ssCall++
        return { data: schoolSummaryByCall[ssCall], error: null }
      },
      region_summary: async () => ({ data: { region_code: 'WALES', region_name: 'Wales', school_count: 1, teacher_count: 2, student_count: 12, total_practice_hours: 4 }, error: null }),
      class_activity_stats: async () => {
        activeDaysCall++
        const idx = activeDaysCall
        await activeDaysDeferreds[idx].promise
        return { data: [], error: null }
      },
    })
    setSchoolsClient(client)

    const { useSchoolData } = await import('./useSchoolData')
    const sd = useSchoolData()

    // Fire the OLDER call first (mimics DashboardView's immediate watcher +
    // onMounted both kicking off a fetch, or a lingering call from a
    // just-unmounted view), then the NEWER call right behind it.
    const older = sd.fetchSchools()
    const newer = sd.fetchSchools()

    // Let the NEWER call's round trip finish FIRST — the realistic case for
    // "went to Analytics and back": the fresh request lands well before any
    // straggler from before the navigation.
    activeDaysDeferreds[1].resolve({ data: [], error: null })
    await newer

    expect(sd.schools.value[0]?.has_admin).toBe(true)

    // NOW the older, stale round trip finally resolves.
    activeDaysDeferreds[0].resolve({ data: [], error: null })
    await older

    // The older call's stale "Awaiting admin" snapshot must NOT have
    // overwritten the newer, correct one.
    expect(sd.schools.value[0]?.has_admin).toBe(true)
    expect(sd.schools.value).toHaveLength(1)
  })
})
