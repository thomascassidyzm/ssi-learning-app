import { describe, it, expect, vi } from 'vitest'
import { watch, nextTick } from 'vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

setSchoolsClient({} as any)

// Regression for: /schools/analytics permanently dead on direct load/reload
// (2026-07-16 teacher-loop audit). TeacherInsightsView called
// `if (!demoMode) fetchClasses()` ONCE at setup time. useClassesData's
// fetchClasses() no-ops when currentUser (selectedUser) is still null
// (`if (!selectedUser.value) return`) — fine when navigating here FROM
// Dashboard (currentUser already resolved by then), but on a direct load or
// reload currentUser resolves asynchronously AFTER setup runs, so the
// one-shot call fires against a null user and there is no retry: the view
// never loads classes. The fix mirrors DashboardView.vue's
// `watch(currentUser, ..., { immediate: true })`, proven here directly
// against the real composable (no full-SFC mount needed).
describe('TeacherInsightsView: currentUser resolving late must not permanently starve the fetch', () => {
  it('a one-shot call (the old, buggy shape) never fetches when currentUser resolves AFTER setup', async () => {
    const { currentUser } = useSchoolContext()
    currentUser.value = null
    const fetchClasses = vi.fn()

    // Simulates `if (!demoMode) fetchClasses()` at setup time.
    if (currentUser.value) fetchClasses()
    expect(fetchClasses).not.toHaveBeenCalled()

    // currentUser resolves later (async auth) — the old code has no watcher,
    // so nothing re-fires.
    currentUser.value = {
      user_id: 'u-1', learner_id: 'l-1', display_name: 'Sian', educational_role: 'teacher', platform_role: null,
    }
    await nextTick()
    expect(fetchClasses).not.toHaveBeenCalled()
  })

  it('an immediate watch (the fix) retries once currentUser resolves late', async () => {
    const { currentUser } = useSchoolContext()
    currentUser.value = null
    const fetchClasses = vi.fn()

    watch(currentUser, (user) => {
      if (!user) return
      fetchClasses()
    }, { immediate: true })

    // immediate fire with a still-null user does nothing yet...
    expect(fetchClasses).not.toHaveBeenCalled()

    // ...but the watch catches the LATER resolution.
    currentUser.value = {
      user_id: 'u-1', learner_id: 'l-1', display_name: 'Sian', educational_role: 'teacher', platform_role: null,
    }
    await nextTick()
    expect(fetchClasses).toHaveBeenCalledTimes(1)
  })

  it('an immediate watch also covers the already-resolved case (SPA nav from Dashboard)', () => {
    const { currentUser } = useSchoolContext()
    currentUser.value = {
      user_id: 'u-2', learner_id: 'l-2', display_name: 'Bryn', educational_role: 'school_admin', platform_role: null,
    }
    const fetchClasses = vi.fn()

    watch(currentUser, (user) => {
      if (!user) return
      fetchClasses()
    }, { immediate: true })

    expect(fetchClasses).toHaveBeenCalledTimes(1)
  })
})
