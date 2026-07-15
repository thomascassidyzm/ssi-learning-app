import { describe, it, expect, vi } from 'vitest'
import { watch } from 'vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData, type School } from '@/composables/schools/useSchoolData'

// fetchSchools()/selectSchoolToView() don't need real data for this test —
// just a client object so getSchoolsClient() doesn't throw.
setSchoolsClient({} as any)

// Regression for the staging bug: a govt_admin clicking a school row on
// /schools/all calls selectSchoolToView(school) THEN router.push('/schools')
// (SchoolsView.vue's handleSchoolClick / the top nav's "Full schools list"
// round trip). By the time DashboardView mounts fresh, viewingSchool is
// already set — a plain `watch(viewingSchool, cb)` (no `immediate: true`)
// never fires on this navigation, since no CHANGE happens post-mount, so
// the drilled-into school's classes never load until an unrelated update
// happens to touch viewingSchool. DashboardView.vue's real watch must use
// `{ immediate: true }` for exactly this reason — this test proves the
// distinction directly against the real composables, without mounting the
// full SFC.

const school: School = {
  id: 's1',
  school_name: 'Ysgol Bro Morgannwg',
  region_code: 'wales',
  group_id: 'g1',
  admin_user_id: null,
  teacher_join_code: 'X',
  admin_join_code: 'Y',
  teacher_count: 3,
  class_count: 5,
  student_count: 16,
  total_practice_hours: 63,
  created_at: '2025-09-02T08:00:00.000Z',
  health: 'good',
}

describe('DashboardView govt-admin drill-down: viewingSchool watch must be immediate', () => {
  function setupGovtAdminViewingSchool() {
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'u-govt',
      learner_id: 'l-govt',
      display_name: 'Gwilym',
      educational_role: 'govt_admin',
      platform_role: null,
      group_id: 'g1',
    }
    const { selectSchoolToView, viewingSchool, clearViewingSchool } = useSchoolData()
    clearViewingSchool()
    // Simulates SchoolsView.vue's handleSchoolClick: viewingSchool is set
    // BEFORE the component that watches it ever mounts.
    selectSchoolToView(school)
    return { ctx, viewingSchool }
  }

  it('a non-immediate watch (the old, buggy shape) misses the pre-set school', () => {
    const { viewingSchool } = setupGovtAdminViewingSchool()
    const fetchClasses = vi.fn()
    watch(viewingSchool, (s) => {
      if (s) fetchClasses()
    })
    expect(fetchClasses).not.toHaveBeenCalled()
  })

  it('an immediate watch (the fix) fetches the drilled-into school\'s classes on mount', () => {
    const { viewingSchool } = setupGovtAdminViewingSchool()
    const fetchClasses = vi.fn()
    watch(viewingSchool, (s) => {
      if (s) fetchClasses()
    }, { immediate: true })
    expect(fetchClasses).toHaveBeenCalledTimes(1)
  })
})
