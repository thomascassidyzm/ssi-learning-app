import { describe, it, expect } from 'vitest'

// Regression for: DashboardView briefly rendered the confident-wrong
// "No classes yet — create your first class" empty state for ~2s before the
// classes fetch resolved (2026-07-16 teacher-loop audit). The template's
// v-if chain (`classesLoading && !length` -> loading; `!length` -> empty)
// mirrors these two pure predicates — while the fetch is in flight,
// `teacherClasses` is legitimately still `[]`, so a bare `!length` check
// can't tell "empty" apart from "not loaded yet" without also consulting
// isLoading.
function showsLoadingState(classesLoading: boolean, classCount: number): boolean {
  return classesLoading && classCount === 0
}
function showsEmptyState(classesLoading: boolean, classCount: number): boolean {
  // v-else-if: only reached once the loading branch is false.
  return !showsLoadingState(classesLoading, classCount) && classCount === 0
}

describe('DashboardView: classes empty-state must not flash before the fetch resolves', () => {
  it('mid-fetch with zero classes so far -> loading state, NOT the empty state', () => {
    expect(showsLoadingState(true, 0)).toBe(true)
    expect(showsEmptyState(true, 0)).toBe(false)
  })

  it('fetch resolved, genuinely zero classes -> the empty state (with create CTA)', () => {
    expect(showsLoadingState(false, 0)).toBe(false)
    expect(showsEmptyState(false, 0)).toBe(true)
  })

  it('classes present -> neither loading nor empty state renders', () => {
    expect(showsLoadingState(true, 3)).toBe(false)
    expect(showsEmptyState(true, 3)).toBe(false)
    expect(showsLoadingState(false, 3)).toBe(false)
    expect(showsEmptyState(false, 3)).toBe(false)
  })
})
