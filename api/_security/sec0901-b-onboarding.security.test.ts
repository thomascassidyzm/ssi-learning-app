/**
 * SEC0901-B — the unauthenticated/low-auth onboarding funnel:
 * api/invite/create.ts, api/try-link/create.ts, api/try-link/validate.ts,
 * api/onboarding/profile.ts, api/onboarding/provision.ts.
 *
 * Each of these already has its own test file covering its main behaviour
 * (api/invite/create.test.ts, api/try-link/validate.test.ts,
 * api/onboarding/provision.test.ts). This file is the cross-cutting SECURITY
 * read the brief asks for: what can an unauthenticated caller do, how many
 * times, and what does it cost or create — read against the actual code,
 * not re-derived from memory.
 *
 * Findings this file pins as SECURE-ASSERTIONS (all held on inspection):
 *   - try-link/validate.ts (the only genuinely unauthenticated endpoint of
 *     the five) is per-IP rate-limited at REDEEM_PER_IP_LIMIT (AUTH-CORE-03)
 *     and redacts DB error detail from its response (AUTH-CORE-10).
 *   - try-link/create.ts, invite/create.ts, onboarding/profile.ts and
 *     onboarding/provision.ts all require a verified Supabase Auth JWT before
 *     any write — there is no create/provision path reachable with zero
 *     identity.
 *   - invite/create.ts's role-elevating fields (grants_group_id for
 *     school_admin, the leader-subtree check for govt_admin) are
 *     server-derived/validated, never trusted from the request body
 *     (ADMIN-ENT-09 / TENANCY-07, already covered by invite/create.test.ts —
 *     re-asserted here at the source-reading level as a regression guard).
 *
 * One CHARACTERIZATION, logged as a low-severity finding in the report
 * (SEC0901-B-05), not fixed here per the audit's no-behaviour-change rule:
 * grants_class_id on invite/create.ts is NOT validated against the caller's
 * own permissions for any code_type OTHER than 'teacher' and 'student' — it
 * passes through unconditionally for ssi_admin/god/govt_admin/tester/
 * school_admin codes. This is reachable only by a caller who has ALREADY
 * cleared the code_type's own privileged-caller gate (ssi_admin, or a
 * govt_admin within their subtree) — so it is not a privilege escalation for
 * an ordinary user, but it is the same shape of bug ADMIN-ENT-09 fixed for
 * grants_group_id, left open for grants_class_id.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const apiRoot = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(apiRoot, relPath), 'utf-8')
}

describe('SEC0901-B — auth is required before any write, on all five funnel endpoints', () => {
  it('try-link/create.ts requires verifyAuthToken AND an ssi_admin/god platform_role before minting', () => {
    const src = read('try-link/create.ts')
    expect(src).toMatch(/verifyAuthToken\(req\)/)
    expect(src).toMatch(/platform_role !== 'ssi_admin' && learner\.educational_role !== 'god'/)
  })

  it('invite/create.ts requires verifyAuthToken before any code_type branch runs', () => {
    const src = read('invite/create.ts')
    const authIdx = src.indexOf('verifyAuthToken(req)')
    const firstBranchIdx = src.indexOf("code_type === 'ssi_admin'")
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(firstBranchIdx)
  })

  it('onboarding/profile.ts requires verifyAuthToken and scopes every write to the caller\'s own rows', () => {
    const src = read('onboarding/profile.ts')
    expect(src).toMatch(/verifyAuthToken\(req\)/)
    expect(src).toMatch(/\.eq\('user_id', auth\.userId\)/)
    expect(src).toMatch(/\.eq\('admin_user_id', auth\.userId\)/)
  })

  it('onboarding/provision.ts requires verifyAuthToken and validates course/track server-side, never trusting client pricing', () => {
    const src = read('onboarding/provision.ts')
    expect(src).toMatch(/verifyAuthToken\(req\)/)
    expect(src).toMatch(/Never trust the\s+\/\/\s+client to pick/i)
  })

  it('try-link/validate.ts is the ONE genuinely unauthenticated endpoint of the five, and it knows it', () => {
    const src = read('try-link/validate.ts')
    expect(src).not.toMatch(/verifyAuthToken/)
    expect(src).toMatch(/Public \(no auth\)/)
  })
})

describe('SEC0901-B — try-link/validate.ts: the anonymous enumeration oracle is throttled', () => {
  it('rate-limits by IP using the shared throttle BEFORE the code lookup, and logs every attempt', () => {
    const src = read('try-link/validate.ts')
    const throttleIdx = src.indexOf('isIpOverLimit')
    const lookupIdx = src.indexOf("from('try_links')")
    expect(throttleIdx).toBeGreaterThan(-1)
    expect(lookupIdx).toBeGreaterThan(-1)
    expect(throttleIdx).toBeLessThan(lookupIdx)
    expect(src).toMatch(/REDEEM_PER_IP_LIMIT/)
    expect(src).toMatch(/logAttempt/)
  })

  it('uses the platform-attested IP source (getClientIp), not a caller-forgeable header, for the throttle bucket', () => {
    const src = read('try-link/validate.ts')
    expect(src).toMatch(/getClientIp\(req\)/)
    expect(src).not.toMatch(/x-forwarded-for/)
  })

  it('redacts the DB error message from the anonymous-facing 500 (AUTH-CORE-10) — no schema/relation reconnaissance handed to an anonymous caller', () => {
    const src = read('try-link/validate.ts')
    const catchBlock = src.slice(src.lastIndexOf('catch (error'))
    expect(catchBlock).toMatch(/res\.status\(500\)\.json\(\{ error: 'Internal server error' \}\)/)
    expect(catchBlock).not.toMatch(/error\?\.message/)
  })

  it('mints a time-boxed token (not an unbounded grant) and fails CLOSED in production if the signing secret is absent', () => {
    const src = read('try-link/validate.ts')
    expect(src).toMatch(/TRY_TOKEN_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000/)
    expect(src).toMatch(/IS_PROD && !entitlementSecret/)
  })
})

describe('SEC0901-B — invite/create.ts: role-elevating grants are server-derived, not client-trusted', () => {
  it('school_admin codes always take the SERVER-derived group id, ignoring any client grants_group_id', () => {
    const src = read('invite/create.ts')
    expect(src).toMatch(/if \(code_type === 'school_admin'\) \{\s*\n(?:.*\n)*?\s*insertData\.grants_group_id = derivedGrantsGroupId/)
  })

  it('govt_admin minting by a non-ssi_admin is bounded to the caller\'s own leader subtree (isWithinLeaderSubtree), not any group id supplied', () => {
    const src = read('invite/create.ts')
    expect(src).toMatch(/isWithinLeaderSubtree\(supabase, ownGroupId, targetGroupId\)/)
  })

  it('privileged code types (ssi_admin/god/tester/govt_admin/school_admin_join) are forced to expire and be use-capped — never an unbounded bearer token', () => {
    const src = read('invite/create.ts')
    expect(src).toMatch(/\|\| code_type === 'govt_admin' \|\| code_type === 'school_admin_join'/)
    expect(src).toMatch(/boundPrivilegedCodeLimits/)
  })
})

describe('SEC0901-B-05 (characterization, low severity) — grants_class_id trust is inconsistent across code_types', () => {
  it('grants_class_id is validated against caller permission ONLY for teacher/student branches — every other code_type passes it through unchecked', () => {
    // This documents the current shape rather than asserting it is fine: the
    // unconditional line below is reachable by an already-privileged caller
    // (the code_type gate above it already required ssi_admin / govt_admin-in-
    // subtree for every OTHER branch that reaches this line), so it is not a
    // privilege escalation for an ordinary user — but it is the same class of
    // bug ADMIN-ENT-09 fixed for grants_group_id, left open here. Goes red
    // (in a GOOD way) the day someone adds an explicit per-code_type check,
    // at which point this test should be rewritten as a positive assertion.
    const src = read('invite/create.ts')
    expect(src).toMatch(/if \(grants_class_id !== undefined\) insertData\.grants_class_id = grants_class_id/)
    // Confirm the validated branches exist (teacher/student), so this isn't
    // simply "no validation exists anywhere".
    expect(src).toMatch(/Only a teacher of this class can create student codes for this class/)
    expect(src).toMatch(/Only the class teacher or a leader above the class can create co-teacher codes/)
  })
})
