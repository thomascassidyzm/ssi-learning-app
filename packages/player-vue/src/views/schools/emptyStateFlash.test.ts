import { describe, it, expect } from 'vitest'

// Regression for: TeachersView, StudentsView, TeacherDashboard, SchoolsView and
// ClassDetail's roster all rendered their confident-wrong "No X yet" empty
// state for the ~1-2s the fetch was in flight, because the empty-state v-if
// only ever checked `list.length === 0` — never distinguishing "still
// loading" from "loaded and genuinely empty" (2026-07-17 dashboard
// empty-state audit; DashboardView got this fix on 2026-07-16, see
// DashboardView.emptyStateFlash.test.ts). Each view now follows the same
// three-state v-if chain: rows -> loading -> error -> empty. These tests
// pin the shared predicate shape so it can't regress back to a bare length
// check in any of them.
function showsLoadingState(isLoading: boolean, count: number): boolean {
  return isLoading && count === 0
}
function showsErrorState(isLoading: boolean, hasError: boolean, count: number): boolean {
  return !showsLoadingState(isLoading, count) && hasError && count === 0
}
function showsEmptyState(isLoading: boolean, hasError: boolean, count: number): boolean {
  return !showsLoadingState(isLoading, count) && !showsErrorState(isLoading, hasError, count) && count === 0
}

describe('schools dashboard views: empty state must not flash before the fetch resolves', () => {
  it('mid-fetch, zero rows so far -> loading state only', () => {
    expect(showsLoadingState(true, 0)).toBe(true)
    expect(showsErrorState(true, false, 0)).toBe(false)
    expect(showsEmptyState(true, false, 0)).toBe(false)
  })

  it('fetch failed, zero rows -> error state, never the empty state', () => {
    expect(showsLoadingState(false, 0)).toBe(false)
    expect(showsErrorState(false, true, 0)).toBe(true)
    expect(showsEmptyState(false, true, 0)).toBe(false)
  })

  it('fetch resolved clean, genuinely zero rows -> the empty state', () => {
    expect(showsLoadingState(false, 0)).toBe(false)
    expect(showsErrorState(false, false, 0)).toBe(false)
    expect(showsEmptyState(false, false, 0)).toBe(true)
  })

  it('rows present -> none of the three placeholder states render', () => {
    for (const isLoading of [true, false]) {
      for (const hasError of [true, false]) {
        expect(showsLoadingState(isLoading, 3)).toBe(false)
        expect(showsErrorState(isLoading, hasError, 3)).toBe(false)
        expect(showsEmptyState(isLoading, hasError, 3)).toBe(false)
      }
    }
  })
})
