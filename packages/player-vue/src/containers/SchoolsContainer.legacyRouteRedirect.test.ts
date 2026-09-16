import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Nav unification (2026-07-29): the pre-hierarchy flat views are retired for
// group-scoped leaders, but their URLs (bookmarks, old links) must keep
// working — /schools/all lands on the node home with the schools lens,
// /schools/analytics on the node insights for the leader's top node. The
// redirect lives in SchoolsContainer as a context watch (loadFromAuth is
// async, so group_id can land after a deep link mounts — same pattern as
// DashboardView's node-home redirect). Guarded at source level in the
// pageTransition-test style; tab-set behaviour is covered in
// SchoolsTopBar.govtAdminTabs.test.ts.
describe('SchoolsContainer legacy flat-view redirect (govt_admin with group)', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/containers/SchoolsContainer.vue'),
    'utf-8',
  )

  it('redirects the retired schools-list route to the node home with the schools lens', () => {
    expect(source).toMatch(/routeName === 'schools-list'/)
    expect(source).toMatch(/path: `\/org\/\$\{groupId\}`, query: \{ lens: 'schools' \}/)
  })

  it('redirects the retired analytics route to the node insights', () => {
    expect(source).toMatch(/routeName === 'analytics'/)
    expect(source).toMatch(/`\/org\/\$\{groupId\}\/insights`/)
  })

  it('fires only for group-scoped govt_admins — legacy no-group rows keep the flat views', () => {
    expect(source).toMatch(/if \(groupId && ctx\.isGovtAdmin\.value\)/)
  })

  // Third persona (2026-07-30): a school-scoped school_admin's retired flat
  // URLs land on THE VIEW too — Dashboard on their school's node home,
  // Analytics on the node insights. Teachers-the-role and legacy no-school
  // rows are untouched. /schools/teachers stopped redirecting in job #624
  // (2026-09-14): the node home's teachers lens went with the filter chips,
  // so the staff list is the one place a leader reads their teachers and the
  // Teachers card on the school overview points at it.
  it('redirects a school_admin\'s retired dashboard/analytics routes to the node surface', () => {
    expect(source).toMatch(/if \(schoolId && ctx\.isSchoolAdmin\.value\)/)
    expect(source).toMatch(/routeName === 'schools-dashboard'/)
    expect(source).toMatch(/`\/org\/\$\{schoolId\}`/)
    expect(source).toMatch(/`\/org\/\$\{schoolId\}\/insights`/)
  })

  it('leaves a school_admin\'s /schools/teachers alone — the staff list is reachable again (job #624)', () => {
    expect(source).not.toMatch(/routeName === 'teachers'/)
    expect(source).not.toMatch(/query: \{ lens: 'teachers' \}/)
  })

  // THE DASHBOARD FOLDED INTO MY CLASSES (Tom's ruling, 2026-09-16): for a
  // teacher /schools was a greeting over a second copy of the classes table,
  // so the greeting moved onto My Classes and the old route hands over to it.
  // Red before the fold — nothing sent a teacher anywhere.
  it('sends a teacher from the retired dashboard route to My Classes', () => {
    expect(source).toMatch(/if \(ctx\.isTeacher\.value && routeName === 'schools-dashboard'\)/)
    expect(source).toMatch(/router\.replace\('\/schools\/classes'\)/)
  })

  it('leaves every other role\'s dashboard alone — the leader cases return before it', () => {
    const teacherAt = source.indexOf("ctx.isTeacher.value && routeName === 'schools-dashboard'")
    const schoolAdminAt = source.indexOf('if (schoolId && ctx.isSchoolAdmin.value)')
    expect(teacherAt).toBeGreaterThan(schoolAdminAt)
    // The school_admin branch ends in a return, so a school-scoped leader
    // never falls through into the teacher case.
    expect(source.slice(schoolAdminAt, teacherAt)).toMatch(/\n      return\n/)
  })

  it('is a watch on the resolving context, not a one-shot (group_id lands async after deep links)', () => {
    const block = source.match(/watch\(\s*\[\(\) => ctx\.currentUser\.value, \(\) => route\.name\][\s\S]*?\{ immediate: true \},?\s*\)/)
    expect(block, 'expected the currentUser+route watch with immediate: true').toBeTruthy()
  })
})
