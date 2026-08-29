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

describe('TENANCY-01 (critical): groups/[id]/invites.ts resolves its subtree by parent_id', () => {
  // SECURITY FINDING TENANCY-01 — FIXED 2026-08-25: `resolveSubtree()` now
  // calls fetchSubtree() (the parent_id walk in _utils/groupSubtree.ts)
  // instead of `.or(path.eq.${path},path.like.${path}/%)`. The old equality
  // branch granted membership to any OTHER root org whose name slugified
  // identically — self-serve creatable (groups/index.ts root-org creation is
  // open to any signed-in user, confirm_duplicate:true bypasses the warning)
  // — which exposed that tenant's invite codes (names, emails, redeemable
  // sign-in URLs) to read and to revoke/rotate/resend.
  it('SECURE: resolveSubtree() uses the parent_id walk (fetchSubtree/descendantIds from groupSubtree.ts), never path equality', () => {
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toContain('fetchSubtree(supabase, groupId)')
    expect(src).not.toMatch(/path\.eq\.\$\{path\}/)
    expect(src).not.toMatch(/\.like\('path'/)
  })
  it('root-org creation is still open to any signed-in user, and confirm_duplicate still bypasses the name-collision warning', () => {
    // Unchanged by design — the collision is now harmless because nothing
    // resolves tenancy from the slug.
    const groupsIndex = read('api/groups/index.ts')
    expect(groupsIndex).toMatch(/Root org creation[\s\S]{0,120}open to any signed-in/)
    expect(groupsIndex).toContain('confirm_duplicate')
  })
})

describe('TENANCY-02 (high): groups/[id]/rate-compare.ts authorizes by parent_id', () => {
  // SECURITY FINDING TENANCY-02 — FIXED 2026-08-25: the non-admin authz branch
  // now resolves with descendantIds(allGroups, scope.groupId). The old fast
  // path granted access on `nodePath === ownPath` (a slug collision, not a
  // relationship) and propagated it via startsWith(ownPath + '/') across the
  // colliding root's entire subtree.
  it('SECURE: the path comparison is gone; access resolves via descendantIds(allGroups, scope.groupId)', () => {
    const src = read('api/groups/[id]/rate-compare.ts')
    expect(src).not.toMatch(/nodePath === ownPath/)
    expect(src).not.toContain('groupPathById')
    expect(src).toContain('descendantIds(allGroups, scope.groupId).includes(nodeId)')
  })
})

describe('TENANCY-04 / TENANCY-05 / INPUT-05: subtree scope no longer resolves from path strings', () => {
  // SECURITY FINDING TENANCY-04/05/INPUT-05 — FIXED 2026-08-25: all three call
  // sites now walk parent_id (descendantIds) instead of `.like('path',
  // \`${path}%\`)`. The unbounded LIKE had no '/' boundary ("acme" matched
  // "acme-group"), and slug paths are not unique either, so a same-named root
  // org shared the path outright — both folded another tenant's classes into a
  // leader's rate-compare cohort and into an org's billable seat count. The
  // parent_id walk closes both, which the segment-safe LIKE form could not.
  it('SECURE: school/rate-compare.ts resolves group subtrees with descendantIds, not a path LIKE', () => {
    const src = read('api/school/rate-compare.ts')
    expect(src).not.toMatch(/\.like\('path'/)
    expect(src).toContain("import { descendantIds } from '../_utils/groupSubtree'")
    expect(src).toContain('descendantIds(forest ?? (await loadGroupForest(svc)), groupId)')
  })
  it('SECURE: _utils/orgPlatform.ts counts org seats over the parent_id subtree', () => {
    const src = read('api/_utils/orgPlatform.ts')
    expect(src).not.toMatch(/\.like\('path'/)
    expect(src).toContain('descendantIds((forest ?? []) as ParentLinked[], groupId)')
  })
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

describe('TENANCY-07: govt_admin / school_admin_join invite codes mint bounded', () => {
  // SECURITY FINDING TENANCY-07 — FIXED 2026-08-25: both staff-granting code
  // types now run through boundPrivilegedCodeLimits on BOTH minting paths
  // (and on the group ledger's `rotate`), so they must expire and must carry a
  // use cap. Previously only ssi_admin/god/tester were clamped, leaving codes
  // that grant tenant-level administrative authority unlimited-use and
  // never-expiring.
  it('SECURE: invite/create.ts isPrivileged includes govt_admin and school_admin_join', () => {
    const src = read('api/invite/create.ts')
    expect(src).toMatch(/code_type === 'govt_admin' \|\| code_type === 'school_admin_join'/)
    expect(src).toContain('boundPrivilegedCodeLimits')
  })
  it('SECURE: groups/[id]/invites.ts bounds leader / school_leader mints and rotations', () => {
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toContain('boundPrivilegedCodeLimits')
    expect(src).toContain("PRIVILEGED_ROLES = new Set<Role>(['leader', 'school_leader'])")
    expect(src).toContain('if (PRIVILEGED_ROLES.has(role))')
  })
})

describe('TENANCY-08: all three handlers authorise via canTeachClass()', () => {
  // SECURITY FINDING TENANCY-08 — FIXED 2026-08-25 (it failed closed —
  // availability, not breach): three handlers hand-rolled
  // `school.admin_user_id === callerUserId` instead of the designated
  // canTeachClass()/isSchoolAdminOf() composite, which also accepts an active
  // SCHOOL: admin tag — so a tag-admin (every admin after the founder) was
  // wrongly denied on her own school's classes. All three now call the shared
  // predicate, which is a strict superset of the ladder it replaced.
  it('SECURE: the three handlers call canTeachClass() and no longer hand-roll the founder-pointer check', () => {
    for (const file of [
      'api/school/roster.ts',
      'api/teacher/create-class-join-code.ts',
      'api/teacher/create-class-learner.ts',
    ]) {
      const src = read(file)
      expect(src, file).toContain('canTeachClass(')
      expect(src, file).toMatch(/from '\.\.\/_utils\/classTeacherAuth'/)
      expect(src, file).not.toContain('admin_user_id === callerUserId')
    }
  })
})
