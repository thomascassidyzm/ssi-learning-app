/**
 * AREA C RECONCILIATION (2026-08-25) — admin-entitlement.md findings still live on `dev`.
 *
 * Source: docs/security-audit-2026-08-11/admin-entitlement.md (branch `sec/audit-2026-08-11`,
 * never merged). ADMIN-ENT-01 (fixed by the billing-intent ladder, commit cfff6afc) and
 * ADMIN-ENT-02 (fixed by SEC22-01's pgcrypto minter + service_role-only grant, commit 5ceb08a1)
 * are independently confirmed FIXED and not re-asserted here. ADMIN-ENT-10/-11 are documented
 * design decisions, not defects — not tested.
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

describe('ADMIN-ENT-03: staff-granting invite code types mint at 128 bits', () => {
  // SECURITY FINDING ADMIN-ENT-03 — FIXED 2026-08-25: teacher/school_admin/
  // school_admin_join/govt_admin/ssi_admin codes used generateCode()
  // (24^3 x 10^3 = 13.8M, 23.7 bits), not the 128-bit generateShareCode() that
  // already existed in the same file. Every invite minter now goes through
  // generateCodeForType(), which routes PRIVILEGED_CODE_TYPES to the 128-bit
  // minter and leaves the human-typeable ABC-123 format to the read-aloud
  // population (student/tester and the DB-minted class join codes).
  const MINTERS = [
    'api/invite/create.ts',
    'api/groups/[id]/invites.ts',
    'api/groups/[id]/demo-mint.ts',
    'api/admin/create-govt-admin.ts',
  ]

  it('SECURE: every invite minter routes through generateCodeForType(), never generateCode() directly', () => {
    for (const file of MINTERS) {
      const src = read(file)
      expect(src, file).toMatch(/generateCodeForType\(/)
      // The bare minter must not survive anywhere in the file, import included.
      expect(src, file).not.toMatch(/\bgenerateCode\(\)/)
      expect(src, file).not.toMatch(/import \{[^}]*\bgenerateCode\b[^}]*\} from/)
    }
  })

  it('SECURE: generateCodeForType() sends every staff-granting type to the 128-bit minter', () => {
    const src = read('api/_utils/codeGen.ts')
    for (const t of ['ssi_admin', 'god', 'govt_admin', 'school_admin', 'school_admin_join', 'teacher']) {
      expect(src, t).toContain(`'${t}'`)
    }
    expect(src).toMatch(/PRIVILEGED_CODE_TYPES\.has\(codeType\) \? generateShareCode\(\) : generateCode\(\)/)
  })
})

describe('ADMIN-ENT-04: both webhook idempotency ledgers fail CLOSED on a non-duplicate-key error', () => {
  // SECURITY FINDING ADMIN-ENT-04 — FIXED 2026-08-25: only a 23505 (duplicate key)
  // short-circuits with a 200/deduped; every other dedup error (and a thrown
  // client error) now returns 500 before any side effect, so the provider's
  // at-least-once retry reprocesses instead of the handler running unprotected.
  it('fail closed (500) on any dedup error other than 23505, so the provider retries', () => {
    for (const file of ['api/teacher/paddle-webhook.ts', 'api/teacher/wise-webhook.ts']) {
      const src = read(file)
      expect(src, file).toContain("dedupErr.code === '23505'")
      expect(src, file).toMatch(/Event dedup unavailable \(failing closed\)/)
      expect(src, file).toMatch(/Event dedup threw \(failing closed\)/)
      expect(src, file).not.toMatch(/Event dedup .* \(proceeding\)/)
      expect(src, file).toMatch(/res\.status\(500\)\.json\(\{ error: 'Event dedup unavailable' \}\)/)
    }
  })
})

describe('ADMIN-ENT-05: schools.teacher_seats is enforced on the teacher-code join path', () => {
  // SECURITY FINDING ADMIN-ENT-05 — FIXED 2026-08-25: teacher_seats was written
  // by billing and read only for DISPLAY; no join path compared the current staff
  // count against it, so a school paying for one seat could onboard unlimited
  // teachers via its join code. The teacher branch of redeem.ts now checks the
  // cap before writing the staff tag, mirroring api/family/invite.ts.
  //
  // Scope, deliberate: the cap only applies to a school with a LIVE per-seat
  // subscription. `teacher_seats` is `integer DEFAULT 1 NOT NULL`, so enforcing
  // on the bare column would lock the second teacher out of every trial and
  // free-track school — a product change, not a security fix. See
  // api/_utils/schoolSeats.ts.
  it('SECURE: the teacher-code redemption branch checks the seat cap before tagging', () => {
    const src = read('api/code/redeem.ts')
    expect(src).toContain('isSchoolSeatCapReached')
    expect(src).toMatch(/if \(seatState\.full\)/)
    // The check runs BEFORE the staff tags are written.
    expect(src.indexOf('isSchoolSeatCapReached(supabase')).toBeLessThan(src.indexOf('for (const tag of teacherTags)'))
  })
  it('SECURE: the cap reads the billed quantity, and only where it is billed', () => {
    const src = read('api/_utils/schoolSeats.ts')
    expect(src).toMatch(/teacher_seats, platform_status, provider_subscription_id/)
    expect(src).toMatch(/if \(!school\.provider_subscription_id\) return open/)
    expect(src).toMatch(/used >= seats/)
  })
  it('the family plan enforces its seat cap server-side too (the shape this follows)', () => {
    const src = read('api/family/invite.ts')
    expect(src).toMatch(/Family is full/)
  })
})

describe('ADMIN-ENT-07: /api/entitlement/offline-lease caps and validates courses[]', () => {
  // SECURITY FINDING ADMIN-ENT-07 — FIXED 2026-08-25: readCourses() had no length
  // cap and no check that a submitted string was even course-code shaped, and
  // every entry becomes an upsert row. It now drops anything that is not
  // [a-z0-9_]{1,64} and caps the accepted set at MAX_COURSES.
  it('SECURE: readCourses() caps the list and validates each entry against the course-code shape', () => {
    const src = read('api/entitlement/offline-lease.ts')
    expect(src).toMatch(/const MAX_COURSES = \d+/)
    expect(src).toMatch(/COURSE_CODE_RE\s*=\s*\/\^\[a-z0-9_\]\{1,64\}\$\//)
    expect(src).toMatch(/COURSE_CODE_RE\.test\(code\)/)
    expect(src).toMatch(/if \(out\.size >= MAX_COURSES\) return/)
    expect(src).toMatch(/body\.courses\.slice\(0, MAX_COURSES \* 4\)/)
  })
})

describe('ADMIN-ENT-08: the one-trial-per-email burn canonicalises the burn key', () => {
  // SECURITY FINDING ADMIN-ENT-08 — FIXED 2026-08-25: trial_burns was keyed on the
  // literal (lowercased, trimmed) address, so alice+1@gmail.com and
  // alice+2@gmail.com were distinct keys delivering to one inbox and minted
  // indefinite fresh platform trials. The burn key is now canonicalised (+tag
  // stripped; dots stripped on gmail/googlemail only, where they are ignored).
  // The raw address is still what is stored for display/contact elsewhere.
  it('SECURE: burnTrial keys on canonicaliseEmailForBurn(), not the raw address', () => {
    const src = read('api/_utils/schoolPlatformTrial.ts')
    expect(src).toContain('export function canonicaliseEmailForBurn')
    expect(src).toMatch(/const email = canonicaliseEmailForBurn\(rawEmail\)/)
    expect(src).toContain(".insert({ email, track, school_id: schoolId })")
  })

  it('SECURE: +tag aliases and gmail dot-variants collapse to one burn key', async () => {
    const { canonicaliseEmailForBurn } = await import('../_utils/schoolPlatformTrial')
    expect(canonicaliseEmailForBurn('Alice+1@Gmail.com')).toBe('alice@gmail.com')
    expect(canonicaliseEmailForBurn('a.l.i.c.e+99@googlemail.com')).toBe('alice@googlemail.com')
    expect(canonicaliseEmailForBurn(' alice@gmail.com ')).toBe('alice@gmail.com')
    // Dots stay significant off gmail; +tag still goes.
    expect(canonicaliseEmailForBurn('a.b+tag@school.wales')).toBe('a.b@school.wales')
    // Degenerate input is passed through rather than mangled into a shared key.
    expect(canonicaliseEmailForBurn('not-an-email')).toBe('not-an-email')
    expect(canonicaliseEmailForBurn('+tag@gmail.com')).toBe('+tag@gmail.com')
  })
})

describe('ADMIN-ENT-09: /api/invite/create only persists grant fields its branch authorised', () => {
  // SECURITY FINDING ADMIN-ENT-09 — FIXED 2026-08-25. The insert used to copy
  // grants_group_id straight from the body for EVERY code_type whose validation
  // block never checked it. The 2026-08-11 report called that inert on a
  // "no school AND no class" redemption precondition; the 2026-08-25 re-trace
  // found that argument covers only the teacher and student redemption
  // branches, and — more to the point — that nobody had looked at the READ
  // path. api/code/validate.ts resolves grants_group_id and returns
  // groups.name, and it fires for a student code BEFORE the class branch, so a
  // teacher minting a student code for their own class could attach any group
  // id and read that group's name back.
  //
  // govt_admin is the only type for which a client-supplied group id is
  // meaningful, and it is server-validated (isWithinLeaderSubtree for a leader;
  // an ssi_admin is the platform operator). school_admin takes the
  // server-derived value in the branch above. Everything else drops it.
  it('SECURE: grants_group_id is only copied from the body for the server-validated govt_admin branch', () => {
    const src = read('api/invite/create.ts')
    expect(src).toMatch(
      /\} else if \(code_type === 'govt_admin' && grants_group_id !== undefined\) \{/,
    )
    // The unconditional copy must not survive.
    expect(src).not.toMatch(/\} else if \(grants_group_id !== undefined\) \{/)
  })

  it('SECURE: the govt_admin branch that feeds it is still the server-validated one', () => {
    const src = read('api/invite/create.ts')
    expect(src).toContain('isWithinLeaderSubtree(supabase, ownGroupId, targetGroupId)')
    // school_admin keeps taking the derived value, never the raw body value.
    expect(src).toMatch(/insertData\.grants_group_id = derivedGrantsGroupId \?\? null/)
  })
})

describe('ADMIN-ENT-12: grant/revoke-entitlement authorise via the shared verifyAdmin', () => {
  // SECURITY FINDING ADMIN-ENT-12 — FIXED 2026-08-25: both endpoints checked
  // platform_role === 'ssi_admin' directly under the service-role key rather than
  // calling the shared verifyAdmin(). Two definitions of "admin" that could
  // silently diverge; both now call the one helper, which also honours
  // educational_role === 'god', reads under the caller's own RLS token, and
  // separates a transient failure (500) from not-an-admin (403).
  it('SECURE: both endpoints call verifyAdmin() and no longer hand-roll the platform_role check', () => {
    for (const file of ['api/admin/grant-entitlement.ts', 'api/admin/revoke-entitlement.ts']) {
      const src = read(file)
      expect(src, file).toContain('verifyAdmin(req)')
      expect(src, file).not.toMatch(/caller\.platform_role !== 'ssi_admin'/)
    }
  })
})
