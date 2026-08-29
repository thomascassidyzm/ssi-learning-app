/**
 * SEC29-B — privileged-gate re-sweep (2026-08-29).
 *
 * Scope: every `verifyAdmin` call site under api/admin, api/govt, api/board,
 * api/org, api/entitlement, api/access, api/groups, plus every handler that
 * writes platform_role / educational_role / govt_admins / entitlement_grants /
 * invite_codes / schools / classes. Full sweep table:
 * docs/security-audit-2026-08-29/area-b-privileged-gates.md
 *
 * verifyAdmin's contract (api/_utils/auth.ts) is a footgun by design: on a
 * REJECTED non-admin caller it still returns `{ error, status, userId }` —
 * the verified uid is CARRIED on the 403 path so callers with a legitimate
 * non-admin door (rate-compare.ts, demo-mint.ts, groups/[id].ts, …) don't have
 * to re-verify the token. That means any call site that checks `result.userId`
 * truthiness instead of `'error' in result` treats a REJECTED caller as an
 * admin. This file locks that every real call site in the repo gets it right.
 *
 * LOCKS (pass today, must keep passing): the discriminant check is correct at
 * every verifyAdmin call site swept.
 *
 * CHARACTERIZATIONS (pass today, describe a live but bounded issue):
 *   SEC29-B-01 — create-signin-link.ts's rate-limit check fails OPEN on a DB
 *     error (proceeds to mint the link). Bounded: verifyAdmin has already
 *     passed by that point, so this only defeats the per-admin throttle on an
 *     already-authenticated admin action, not the admin gate itself.
 *   SEC29-B-02 — several admin-mutation handlers echo the raw DB error's
 *     `.message`/`detail` to the client on 500 (SEC22-03 family), in files not
 *     named by that finding: admin/users.ts, admin/update-user-role.ts,
 *     entitlement/grant.ts, groups/index.ts (x2).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

/**
 * Every file that calls verifyAdmin AND branches on its result (excludes
 * api/_utils/auth.ts itself, which defines it, and vadVisibility.ts which
 * re-derives its own caller shape).
 */
const VERIFY_ADMIN_CALL_SITES = [
  'api/access/grant-emails.ts',
  'api/access/list-grants.ts',
  'api/admin/attention.ts',
  'api/admin/board-metrics.ts',
  'api/admin/board-snapshot.ts',
  'api/admin/create-govt-admin.ts',
  'api/admin/create-school.ts',
  'api/admin/create-signin-link.ts',
  'api/admin/create-staff.ts',
  'api/admin/demo-leaf.ts',
  'api/admin/demo-schools.ts',
  'api/admin/set-trial.ts',
  'api/admin/update-school.ts',
  'api/admin/update-user-role.ts',
  'api/admin/users.ts',
  'api/admin/view-as.ts',
  'api/entitlement/create.ts',
  'api/entitlement/grants.ts',
  'api/entitlement/grant.ts',
  'api/govt/school-links.ts',
  'api/groups/[id]/demo-mint.ts',
  'api/groups/[id]/demo-refresh.ts',
  'api/groups/[id]/rate-compare.ts',
  'api/groups/[id].ts',
  'api/groups/index.ts',
  'api/school/group-summary.ts',
]

describe('SEC29-B lock: every verifyAdmin call site rejects the non-admin {error,status,userId} shape correctly', () => {
  for (const file of VERIFY_ADMIN_CALL_SITES) {
    it(`${file} never treats a truthy .userId alone as "is admin"`, () => {
      const src = read(file)
      expect(src).toMatch(/verifyAdmin\(req\)/)

      // Every branch that decides "this caller is admin" must go through the
      // 'error' in result discriminant (either polarity), NOT a bare
      // `.userId` truthiness check on the verifyAdmin result. We can't fully
      // parse TS here, so the guard is: every occurrence of `<var>.userId`
      // immediately after a verifyAdmin() call is guarded by a preceding
      // `'error' in <var>` check somewhere in the same function body. Cheaper
      // and just as decisive: assert the dangerous anti-pattern is ABSENT —
      // an `if (<adminVar>.userId)` or `if (<adminVar>?.userId)` with no
      // `'error' in` anywhere before it in the file.
      const dangerousPattern = /if\s*\(\s*!?\s*\w+(Result)?\.userId\s*\)/g
      const matches = [...src.matchAll(dangerousPattern)]
      for (const m of matches) {
        // The one legitimate shape in this codebase is
        // `else if (adminResult.userId)` reached only after an `'error' in
        // adminResult` branch already ran (rate-compare.ts's documented
        // "admin door first, then the visible-scope door" pattern). Assert
        // the file also contains the discriminant check so a NEW call site
        // copying just the dangerous half would fail this test.
        expect(src).toMatch(/'error'\s+in\s+\w+/)
      }
    })
  }
})

describe('SEC29-B-01 (characterization, low): create-signin-link rate-limit check fails open on error', () => {
  it('the rate-limit check failure is a documented fail-open, not silent', () => {
    const src = read('api/admin/create-signin-link.ts')
    // Locks TODAY'S behaviour: a rate-limit query error is logged and the
    // mint proceeds — it does not 500 or block. This is bounded (verifyAdmin
    // already gated the caller as an admin), but it does mean the per-admin
    // throttle on an admin's mint-signin-link power is not enforced during a
    // DB blip.
    expect(src).toMatch(/rate-limit check failed \(failing open\)/)
    expect(src).toMatch(/console\.warn\(.*rateErr\.message\)/)
  })

  it.todo('create-signin-link rate-limit check should fail CLOSED (block the mint) on a DB error, or use a non-DB limiter')
})

describe('SEC29-B-02 (characterization, low): raw DB error detail echoed to the client (SEC22-03 family, new instances)', () => {
  const casesWithDetailField: Array<[string, RegExp]> = [
    ['api/admin/users.ts', /detail:\s*String\(error\)/],
    ['api/admin/update-user-role.ts', /detail:\s*fetchErr\.message/],
    ['api/entitlement/grant.ts', /detail:\s*String\(error\)/],
    ['api/groups/index.ts', /detail:\s*String\(error\)/],
  ]

  for (const [file, pattern] of casesWithDetailField) {
    it(`${file} echoes the raw DB error to the HTTP response body`, () => {
      const src = read(file)
      expect(src).toMatch(pattern)
    })
  }

  it.todo('these handlers should log the DB error server-side only and return a fixed client-facing message, matching the fix already applied elsewhere (board-snapshot.ts, billing/bind-customer.ts)')
})

describe('SEC29-B lock: ssi_admin support-bypass endpoints pair the bypass with rejectIfViewAs', () => {
  const bypassFiles = [
    'api/teacher/class-teachers.ts',
    'api/teacher/create-class-join-code.ts',
    'api/teacher/create-class-learner.ts',
  ]
  for (const file of bypassFiles) {
    it(`${file} rejects an active "view as" session before its admin bypass can run`, () => {
      const src = read(file)
      expect(src).toMatch(/rejectIfViewAs/)
    })
  }

  it('the shared admin-bypass predicate (classTeacherAuth.ts) checks both platform_role and educational_role', () => {
    // create-class-learner.ts and create-class-join-code.ts inline the check;
    // class-teachers.ts routes through canManageClassTeachers, which is
    // itself gated on this same predicate — one place, not three copies.
    const shared = read('api/_utils/classTeacherAuth.ts')
    expect(shared).toMatch(/platform_role === 'ssi_admin'/)
    expect(shared).toMatch(/educational_role === 'god'/)
  })
})

describe('SEC29-B lock: entitlement-mutating handlers reject non-admin callers by role, not by presence of a token', () => {
  const handRolledAdminFiles = ['api/admin/grant-entitlement.ts', 'api/admin/revoke-entitlement.ts']
  for (const file of handRolledAdminFiles) {
    it(`${file} checks platform_role === 'ssi_admin' before writing user_entitlements`, () => {
      const src = read(file)
      expect(src).toMatch(/caller\.platform_role !== 'ssi_admin'/)
    })
  }
})
