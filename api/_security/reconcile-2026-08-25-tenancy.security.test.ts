/**
 * AREA C RECONCILIATION (2026-08-25) — tenancy.md findings still live on `dev`.
 *
 * Source: docs/security-audit-2026-08-11/tenancy.md (branch `sec/audit-2026-08-11`, never merged).
 * TENANCY-03 is independently confirmed FIXED (billing-intent ladder, api/_utils/billingIntent.ts,
 * commit cfff6afc) and is not re-asserted here. TENANCY-09 is a design note (govt_admin is
 * self-serve by design), not a defect — not tested. TENANCY-10 (CORS wildcard) was assessed by the
 * 2026-08-18 audit as not exploitable on this Bearer-only endpoint — see the reconciliation doc.
 *
 * Test convention: characterization tests pass today and carry a `// SECURITY FINDING <ID>:`
 * comment plus a paired `it.todo()` naming the fix. Source-text only — no network, no live DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (relPath: string) => readFileSync(resolve(repoRoot, relPath), 'utf8')

describe('TENANCY-01 (critical): groups/[id]/invites.ts still resolves subtree by slug path equality', () => {
  // SECURITY FINDING TENANCY-01: `path.eq.${path}` grants membership to any
  // OTHER root org whose name slugifies identically — an attacker can
  // self-serve-create the collision (groups/index.ts root-org creation is
  // open to any signed-in user, confirm_duplicate:true bypasses the warning),
  // then read that tenant's invite codes (names, emails, redeemable sign-in
  // URLs) and revoke/rotate/resend them.
  it('resolveSubtree() still ORs an exact path.eq alongside the segment-safe path.like', () => {
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toMatch(/\.or\(`path\.eq\.\$\{path\},path\.like\.\$\{path\}\/%`\)/)
  })
  it('root-org creation is still open to any signed-in user, and confirm_duplicate still bypasses the name-collision warning', () => {
    const groupsIndex = read('api/groups/index.ts')
    expect(groupsIndex).toMatch(/Root org creation[\s\S]{0,120}open to any signed-in/)
    expect(groupsIndex).toContain('confirm_duplicate')
  })
  it.todo('SECURE: resolveSubtree() should use the parent_id walk (fetchSubtree/descendantIds from groupSubtree.ts), never path equality')
})

describe('TENANCY-02 (high): groups/[id]/rate-compare.ts still authorizes on slug path equality', () => {
  // SECURITY FINDING TENANCY-02: the fast path grants access when
  // `nodePath === ownPath` (a collision, not a relationship) and propagates
  // via startsWith(ownPath + '/') to the colliding root's ENTIRE subtree,
  // even though the correct parent_id walk is imported in the same file.
  it('the non-admin authz branch still compares path strings before falling back to isStrictDescendantGroup', () => {
    const src = read('api/groups/[id]/rate-compare.ts')
    expect(src).toMatch(/nodePath === ownPath \|\| nodePath\.startsWith\(ownPath \+ '\/'\)/)
    expect(src).toContain('isStrictDescendantGroup')
  })
  it.todo('SECURE: delete the path comparison; always resolve via descendantIds(allGroups, scope.groupId)')
})

describe('TENANCY-04 / TENANCY-05 / INPUT-05: unanchored path LIKE still crosses tenants', () => {
  // SECURITY FINDING TENANCY-04/05/INPUT-05: `.like('path', \`${path}%\`)` with
  // no '/' boundary matches a sibling org whose name is a prefix collision
  // ("acme" matches "acme-group"), folding another tenant's classes into a
  // leader's own rate-compare cohort and org billing seat count. The
  // segment-safe idiom (`path.eq.${path},path.like.${path}/%`) already exists
  // in the same codebase (groups/[id]/invites.ts) and is not used here.
  it('school/rate-compare.ts subtreeClassIdsForGroupPath still uses an unbounded like(path, `${path}%`)', () => {
    const src = read('api/school/rate-compare.ts')
    expect(src).toMatch(/\.like\('path', `\$\{path\}%`\)/)
  })
  it('_utils/orgPlatform.ts still uses the same unbounded pattern for org seat counting', () => {
    const src = read('api/_utils/orgPlatform.ts')
    expect(src).toMatch(/\.like\('path', `\$\{path\}%`\)/)
  })
  it.todo('SECURE: replace all three call sites with the segment-safe path.eq/path.like(+"/%") form')
})

describe('TENANCY-06: /api/teacher/by-code is metered — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25 by sharing the per-IP limiter (api/_utils/codeAttemptThrottle.ts),
  // same possession_mint_attempts ledger and window as code/validate,
  // code/redeem and try-link/validate — so a sweep spread across all four
  // accumulates in ONE bucket rather than getting four budgets.
  //
  // It stays UNAUTHENTICATED on purpose, and that is not the finding being
  // dodged: this is the public /with/{code} student gateway, and a pupil
  // arriving on a teacher's link has no account yet, so requiring auth would
  // break the join flow the endpoint exists for. What it must not be is
  // unmetered. It uses the wider REDEEM_PER_IP_LIMIT because a class of pupils
  // opening one link through one school NAT is the legitimate shape, and the
  // narrow limit would lock out the eleventh child holding a correct link.
  it('SECURE: by-code.ts shares the code/validate.ts per-IP throttle', () => {
    const src = read('api/teacher/by-code.ts')
    expect(src).toContain("from '../_utils/codeAttemptThrottle'")
    expect(src).toContain('isIpOverLimit')
    expect(src).toMatch(/status\(429\)/)
    expect(src).toMatch(/logAttempt\([\s\S]{0,120}rate_limited_ip/)
    expect(src).toMatch(/logAttempt\([\s\S]{0,120}class_by_code_attempt/)
    // The throttle is decided before any class lookup.
    expect(src.indexOf('isIpOverLimit')).toBeLessThan(src.indexOf("from('classes')"))
  })
})

describe('TENANCY-07: govt_admin / school_admin_join invite codes still mint unbounded', () => {
  // SECURITY FINDING TENANCY-07: boundPrivilegedCodeLimits only clamps
  // ssi_admin/god/tester, so a govt_admin or school_admin_join code — both of
  // which grant tenant-level administrative authority — can be minted with no
  // expiry and unlimited uses on both minting paths.
  it('invite/create.ts isPrivileged still excludes govt_admin and school_admin_join', () => {
    const src = read('api/invite/create.ts')
    expect(src).toMatch(/isPrivileged = code_type === 'ssi_admin' \|\| code_type === 'god' \|\| code_type === 'tester'/)
  })
  it('groups/[id]/invites.ts mints govt_admin/school_admin_join codes with no boundPrivilegedCodeLimits call', () => {
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toMatch(/if \(limits\?\.expires_at !== undefined\) insertData\.expires_at = limits\.expires_at/)
    expect(src).not.toContain('boundPrivilegedCodeLimits')
  })
  it.todo('SECURE: extend isPrivileged to include govt_admin and school_admin_join on both minting paths')
})

describe('TENANCY-08: school-admin recognised under one spelling in three handlers', () => {
  // SECURITY FINDING TENANCY-08 (fails closed — availability, not breach):
  // three handlers hand-roll `school.admin_user_id === callerUserId` instead
  // of the designated canTeachClass()/isSchoolAdminOf() composite, which also
  // accepts an active SCHOOL: admin tag — so a tag-admin (every admin after
  // the founder) is wrongly denied on her own school's classes.
  it('three handlers still hand-roll the founder-pointer-only admin check', () => {
    for (const file of [
      'api/school/roster.ts',
      'api/teacher/create-class-join-code.ts',
      'api/teacher/create-class-learner.ts',
    ]) {
      const src = read(file)
      expect(src, file).toContain('admin_user_id === callerUserId')
      expect(src, file).not.toContain('canTeachClass(')
    }
  })
  it.todo('SECURE: replace the three hand-rolled ladders with canTeachClass()')
})
