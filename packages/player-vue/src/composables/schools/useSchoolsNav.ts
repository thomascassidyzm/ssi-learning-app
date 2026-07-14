/**
 * useSchoolsNav — route-prefix-aware internal nav for shared schools views.
 *
 * DashboardView.vue, TeacherDashboard.vue, StudentsView.vue etc are mounted
 * BOTH as the learner's own /schools/* routes AND as read-only
 * admin-school-* / admin-group-* routes nested under /admin/schools/:id and
 * /admin/groups/:id. A hardcoded `/schools/...` link in a shared component
 * ejects an ssi_admin viewing another school straight into the admin's OWN
 * scope on click, carrying whatever stale context useSchoolContext still
 * holds — see docs/audits/2026-07-13-bug-class-audit.md #1b.
 *
 * Build every internal nav target through this composable instead of a
 * literal `/schools/...` string.
 */
import { inject } from 'vue'
import { useRoute } from 'vue-router'

export type SchoolsNavKind =
  | 'classes'
  | 'class-detail'
  | 'teachers'
  | 'students'
  | 'analytics'
  | 'settings'
  | 'schools-list'

export function useSchoolsNav() {
  const isAdminView = inject<boolean>('isAdminView', false)
  const route = useRoute()

  // `schoolId` overrides the route's own :id — used by the govt-admin
  // drill-into-a-school-within-my-group view (DashboardView's
  // selectSchoolToView/viewingSchool), which needs the SCHOOL's id, not the
  // group id in the group-scope route.
  function schoolsLink(kind: SchoolsNavKind, params?: { classId?: string; schoolId?: string }): string {
    if (!isAdminView) {
      switch (kind) {
        case 'classes': return '/schools/classes'
        case 'class-detail': return `/schools/classes/${params?.classId ?? ''}`
        case 'teachers': return '/schools/teachers'
        case 'students': return '/schools/students'
        case 'analytics': return '/schools/analytics'
        case 'settings': return '/schools/settings'
        case 'schools-list': return '/schools/all'
      }
    }

    const isGroupScope = String(route.name ?? '').startsWith('admin-group')
    const id = route.params.id as string

    if (isGroupScope && !params?.schoolId) {
      const groupBase = `/admin/groups/${id}`
      switch (kind) {
        case 'schools-list': return `${groupBase}/schools`
        case 'analytics': return `${groupBase}/analytics`
        // Classes/teachers/students/settings/class-detail have no group-scope
        // read-view — fall back to the group dashboard rather than ejecting
        // into the admin's own /schools.
        default: return groupBase
      }
    }

    const schoolBase = `/admin/schools/${params?.schoolId ?? id}`
    switch (kind) {
      case 'classes': return `${schoolBase}/classes`
      case 'class-detail': return `${schoolBase}/classes/${params?.classId ?? ''}`
      case 'teachers': return `${schoolBase}/teachers`
      case 'students': return `${schoolBase}/students`
      case 'analytics': return `${schoolBase}/analytics`
      case 'schools-list': return schoolBase
      // No settings read-view under /admin/schools/:id — fall back to dashboard.
      case 'settings': return schoolBase
    }
  }

  return { schoolsLink, isAdminView }
}
