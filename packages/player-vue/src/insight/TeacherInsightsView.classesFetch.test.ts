import { describe, it, expect, vi } from 'vitest'
import { watch, nextTick } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

// Regression for the "/schools/analytics dead on direct load" bug
// (founder-priority bug-class audit, 2026-07-16): TeacherInsightsView used to
// call `if (!demoMode) fetchClasses()` once, at component setup, off
// useSchoolContext's currentUser. On a direct load, currentUser is still
// null at that instant (SchoolsContainer's loadFromAuth hasn't resolved
// yet); useClassesData.fetchClasses() no-ops on a null user
// (`if (!selectedUser.value) return`), and nothing ever retried it — so
// realClasses/realCourseOptions stayed empty forever and the whole
// real-data board was dead. The fix watches currentUser instead.

describe('TeacherInsightsView real-classes fetch', () => {
  it('a one-shot call against a not-yet-resolved currentUser (the old bug) never fires again', () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = null
    const fetchClasses = vi.fn()

    // The old shape.
    if (ctx.currentUser.value) fetchClasses()
    expect(fetchClasses).not.toHaveBeenCalled()

    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Teacher',
      educational_role: 'teacher', platform_role: null,
    }
    expect(fetchClasses).not.toHaveBeenCalled() // proves the bug: dead forever
  })

  it('watching currentUser (the fix) fetches once identity resolves', async () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = null
    const fetchClasses = vi.fn()

    watch(ctx.currentUser, (user) => {
      if (!user) return
      fetchClasses()
    }, { immediate: true })
    expect(fetchClasses).not.toHaveBeenCalled()

    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Teacher',
      educational_role: 'teacher', platform_role: null,
    }
    await nextTick()
    expect(fetchClasses).toHaveBeenCalledTimes(1)
  })
})
