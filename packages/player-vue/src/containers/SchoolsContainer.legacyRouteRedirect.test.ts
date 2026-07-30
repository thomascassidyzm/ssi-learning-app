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
    expect(source).toMatch(/path: `\/schools\/org\/\$\{groupId\}`, query: \{ lens: 'schools' \}/)
  })

  it('redirects the retired analytics route to the node insights', () => {
    expect(source).toMatch(/routeName === 'analytics'/)
    expect(source).toMatch(/`\/schools\/org\/\$\{groupId\}\/insights`/)
  })

  it('fires only for group-scoped govt_admins — legacy no-group rows keep the flat views', () => {
    expect(source).toMatch(/if \(groupId && ctx\.isGovtAdmin\.value\)/)
  })

  // Third persona (2026-07-30): a school-scoped school_admin's retired flat
  // URLs land on THE VIEW too — Dashboard on their school's node home,
  // Teachers on the node home with the teachers lens, Analytics on the node
  // insights. Teachers-the-role and legacy no-school rows are untouched.
  it('redirects a school_admin\'s retired dashboard/teachers/analytics routes to the node surface', () => {
    expect(source).toMatch(/if \(schoolId && ctx\.isSchoolAdmin\.value\)/)
    expect(source).toMatch(/routeName === 'schools-dashboard'/)
    expect(source).toMatch(/`\/schools\/org\/\$\{schoolId\}`/)
    expect(source).toMatch(/routeName === 'teachers'/)
    expect(source).toMatch(/path: `\/schools\/org\/\$\{schoolId\}`, query: \{ lens: 'teachers' \}/)
    expect(source).toMatch(/`\/schools\/org\/\$\{schoolId\}\/insights`/)
  })

  it('is a watch on the resolving context, not a one-shot (group_id lands async after deep links)', () => {
    const block = source.match(/watch\(\s*\[\(\) => ctx\.currentUser\.value, \(\) => route\.name\][\s\S]*?\{ immediate: true \},?\s*\)/)
    expect(block, 'expected the currentUser+route watch with immediate: true').toBeTruthy()
  })
})
