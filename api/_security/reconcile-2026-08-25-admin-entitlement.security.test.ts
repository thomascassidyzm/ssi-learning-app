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

describe('ADMIN-ENT-03: staff-granting invite codes still mint at the same 13.8M keyspace', () => {
  // SECURITY FINDING ADMIN-ENT-03: teacher/school_admin/school_admin_join/
  // govt_admin codes still use generateCode() (24^3 x 10^3 = 13.8M), not the
  // 128-bit generateShareCode() already in the same file — a throttle is the
  // only brake on a 23.7-bit secret that grants staff/admin roles.
  it('invite/create.ts and groups/[id]/invites.ts still mint staff codes with generateCode(), not generateShareCode()', () => {
    for (const file of ['api/invite/create.ts', 'api/groups/[id]/invites.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/generateCode\(\)/)
    }
  })
  it.todo('SECURE: mint staff-granting code types (teacher/school_admin/govt_admin/school_admin_join) at 128 bits via generateShareCode()')
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

describe('ADMIN-ENT-05: schools.teacher_seats is still not enforced on any join path', () => {
  // SECURITY FINDING ADMIN-ENT-05: teacher_seats is written by billing and
  // read only for DISPLAY. No join/redemption path compares the current
  // staff count against it — unlike the family plan, which enforces its cap
  // server-side (api/family/invite.ts) — so a school paying for one seat can
  // onboard unlimited teachers via its join code.
  it('the teacher-code redemption branch writes the staff tag with no seat-count comparison', () => {
    const src = read('api/code/redeem.ts')
    expect(src).not.toMatch(/teacher_seats/)
  })
  it('the family plan DOES enforce its seat cap server-side (the counter-example that makes this an omission)', () => {
    const src = read('api/family/invite.ts')
    expect(src).toMatch(/Family is full/)
  })
  it.todo('SECURE: gate teacher-tagging paths on current staff count vs teacher_seats, mirroring api/family/invite.ts')
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

describe('ADMIN-ENT-09: /api/invite/create still persists grant fields the caller was not authorised for', () => {
  // SECURITY FINDING ADMIN-ENT-09 (confirmed inert today, latent): the insert
  // still copies grants_region/grants_group_id/grants_class_id straight from
  // the body for code_type branches whose validation block never checked
  // them — inert only because redemption happens to require "no school AND
  // no class" for a group grant to fire.
  it('invite/create.ts still has an unconditional else-if that copies the raw grants_group_id from the body', () => {
    const src = read('api/invite/create.ts')
    expect(src).toMatch(/\} else if \(grants_group_id !== undefined\) \{\s*insertData\.grants_group_id = grants_group_id/)
  })
  it.todo('SECURE: assemble insertData grant fields inside each code_type branch; drop anything the branch did not authorise')
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
