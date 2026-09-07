import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../practiceByCourse', () => ({
  fetchPracticeByCourse: vi.fn(async () => [
    { course_code: 'afr_for_eng', practice_minutes: 8610, is_estimated: false },
  ]),
}))

/**
 * A query builder that resolves to `result` regardless of which chain
 * methods (.eq/.gte/...) are called on it — mirrors the supabase-js
 * thenable query builder closely enough for this composable's usage.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  }
  return builder
}

function makeClient(tableResults: Record<string, { data: unknown; error: unknown }>) {
  return {
    from: (table: string) => makeBuilder(tableResults[table] ?? { data: [], error: null }),
  } as any
}

describe('useAdminCourses', () => {
  // courses/courseStats are module-level singleton refs (shared across every
  // call site: AdminCourses.vue, FrictionTab.vue, ContentFrictionBoard.vue),
  // so each test needs a fresh module instance or state leaks between tests.
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not query seed_progress at all (it was the query that timed out and wiped every stat)', async () => {
    const { useAdminCourses } = await import('./useAdminCourses')
    const fromSpy = vi.fn((_table: string) => makeBuilder({ data: [], error: null }))
    const client = { from: fromSpy } as any

    const { fetchCourses } = useAdminCourses(client)
    await fetchCourses()

    expect(fromSpy).not.toHaveBeenCalledWith('seed_progress')
  })

  it('keeps enrolled/active/practice stats when they all succeed', async () => {
    const { useAdminCourses } = await import('./useAdminCourses')
    const client = makeClient({
      courses: { data: [{ course_code: 'afr_for_eng', known_lang: 'eng', target_lang: 'afr', display_name: 'Afrikaans' }], error: null },
      course_enrollments: { data: [{ learner_id: 'l1', course_id: 'afr_for_eng' }, { learner_id: 'l2', course_id: 'afr_for_eng' }], error: null },
      sessions: { data: [{ learner_id: 'l1', course_id: 'afr_for_eng' }], error: null },
    })

    const { fetchCourses, getStats, error } = useAdminCourses(client)
    await fetchCourses()

    expect(error.value).toBeNull()
    const stats = getStats('afr_for_eng')
    expect(stats.enrolled_count).toBe(2)
    expect(stats.active_30d).toBe(1)
    expect(stats.total_practice_minutes).toBe(8610)
  })

  it('a failing sessions query no longer wipes out enrolled_count and practice minutes that already loaded (the regression: an unguarded query timing out used to throw and abort the whole fetch before courseStats was ever assigned)', async () => {
    const { useAdminCourses } = await import('./useAdminCourses')
    const client = makeClient({
      courses: { data: [{ course_code: 'afr_for_eng', known_lang: 'eng', target_lang: 'afr', display_name: 'Afrikaans' }], error: null },
      course_enrollments: { data: [{ learner_id: 'l1', course_id: 'afr_for_eng' }], error: null },
      sessions: { data: null, error: { message: 'canceling statement due to statement timeout' } },
      // Reproduces the original failure mode even though the fixed code no
      // longer queries this table at all (asserted above) — if a future
      // regression reintroduced an unguarded seed_progress query, this
      // result would make it throw exactly as the live one did.
      seed_progress: { data: null, error: { message: 'canceling statement due to statement timeout' } },
    })

    const { fetchCourses, getStats, error } = useAdminCourses(client)
    await fetchCourses()

    const stats = getStats('afr_for_eng')
    // Before the fix, a downstream throw (from seed_progress, or now from
    // sessions) aborted fetchCourses() before courseStats.value was ever
    // assigned, so EVERY stat rendered as its zero-fallback even though
    // enrollments and practice minutes had already been fetched successfully.
    expect(stats.enrolled_count).toBe(1)
    expect(stats.total_practice_minutes).toBe(8610)
    // The one stat that genuinely failed is 0 (no session data to count),
    // and the failure is surfaced rather than silently swallowed.
    expect(stats.active_30d).toBe(0)
    expect(error.value).toMatch(/active learners/)
  })
})
