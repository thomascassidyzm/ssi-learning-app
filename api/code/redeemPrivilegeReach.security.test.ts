/**
 * SEC25-X-03 — the `ssi_admin` door. FIXED 2026-08-25 (redeem half; see the
 * NAMED GAP at the bottom of this file for the mint half).
 *
 * WHAT WAS WRONG. Three facts composed, and no single area of the 2026-08-25
 * audit could see all three:
 *
 *   1. `redeem.ts` is the grant path for `platform_role = 'ssi_admin'`. A code
 *      of type `ssi_admin` (or the legacy `god`) set full platform privilege on
 *      the redeemer, selected on `codeType` ALONE — no second condition, no
 *      out-of-band step, nothing a privileged type had to satisfy that a
 *      student type did not.
 *   2. Every invite code, INCLUDING that type, was minted by the one shared
 *      `generateCode()` in ABC-123 format: 24^3 x 10^3 = 13,824,000. The
 *      authors demonstrably knew how to mint a 128-bit code —
 *      `generateShareCode()` sits in the same file, used for board share links.
 *   3. A bearer token is not a cost, because sign-up is open self-service OTP.
 *
 * So the only control bounding an attacker guessing codes against the highest
 * privilege in the system was `REDEEM_PER_IP_LIMIT`, whose bucket key the
 * attacker chose (SEC25-A-01 / AUTH-CORE-05). That is not a limiter, it is a
 * formality.
 *
 * HOW IT WAS FIXED, in three parts:
 *
 *   a. The bucket key is now platform-attested — see
 *      api/_utils/codeAttemptThrottle.ts and its security test. The limiter
 *      binds again.
 *   b. `generateCodeForType()` (api/_utils/codeGen.ts) mints privileged types
 *      from 128 bits and leaves the human-typeable format to the codes people
 *      actually read aloud.
 *   c. THE ONE THAT BINDS, and the one asserted here: `redeemInviteCode()`
 *      refuses to grant `ssi_admin`/`god` from a weak-keyspace code value at
 *      all. This covers codes minted BEFORE (b), which is the population that
 *      matters, since (b) can only ever protect codes minted after it.
 *
 * WHY THE REDEEM GATE IS SCOPED TO ssi_admin/god AND NO WIDER. Those are held
 * by a handful of staff and re-minting one is a two-minute job, so failing
 * closed costs nothing real. The staff tiers below — govt_admin, school_admin,
 * teacher — are held by live schools mid-term, and retro-invalidating their
 * existing codes would lock working users out of their own dashboards to close
 * a hole that (a) and (b) already narrow. They get 128 bits going forward and
 * are not retro-invalidated. That is a deliberate, stated trade, not an
 * oversight.
 *
 * Nothing here touches a database or a network — every assertion reads source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  generateCode,
  generateCodeForType,
  isStrongCodeFormat,
  PRIVILEGED_CODE_TYPES,
} from '../_utils/codeGen'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

const redeem = src('redeem.ts')
const codeGen = src('../_utils/codeGen.ts')
const throttle = src('../_utils/codeAttemptThrottle.ts')

describe('SEC25-X-03: the reach of the endpoint behind the throttle', () => {
  // ── Fact 1: redeem grants full platform privilege (unchanged, still true) ──

  it('redeem.ts sets platform_role = ssi_admin for the ssi_admin/god code types', () => {
    expect(redeem).toMatch(/codeType === 'ssi_admin' \|\| codeType === 'god'/)
    expect(redeem).toContain("learnerUpdate.platform_role = 'ssi_admin'")
  })

  it('and that update is applied to the redeeming account', () => {
    expect(redeem).toMatch(/\.from\('learners'\)\s*\n?\s*\.update\(learnerUpdate\)/)
  })

  // ── Fact 2, FIXED: privileged codes no longer share the small keyspace ──

  it('SEC25-X-03: privileged code types mint from the 128-bit keyspace', () => {
    // The human-typeable format survives for the codes humans type.
    expect(codeGen).toContain("const CODE_CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'")
    expect(CODE_CONSONANTS_LEN ** 3 * 10 ** 3).toBe(13_824_000)
    expect(generateCodeForType('student')).toMatch(/^[A-Z]{3}-[0-9]{3}$/)

    // Every privileged type does not.
    for (const type of PRIVILEGED_CODE_TYPES) {
      const code = generateCodeForType(type)
      expect(code, type).not.toMatch(/^[A-Z]{3}-[0-9]{3}$/)
      // base64url of 16 random bytes: 22 chars, no padding.
      expect(code, type).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(isStrongCodeFormat(code), type).toBe(true)
    }
  })

  it('SEC25-X-03: the privileged set covers every authority-granting type', () => {
    // If a new authority-granting code type is added, this list is the thing
    // that should make someone justify leaving it out.
    for (const type of ['ssi_admin', 'god', 'govt_admin', 'school_admin', 'school_admin_join', 'teacher']) {
      expect(PRIVILEGED_CODE_TYPES.has(type), type).toBe(true)
    }
    // And the read-aloud population keeps the short format on purpose.
    for (const type of ['student', 'tester']) {
      expect(PRIVILEGED_CODE_TYPES.has(type), type).toBe(false)
    }
  })

  it('isStrongCodeFormat separates the two keyspaces with no overlap', () => {
    for (let i = 0; i < 500; i++) {
      expect(isStrongCodeFormat(generateCode())).toBe(false)
      expect(isStrongCodeFormat(generateCodeForType('ssi_admin'))).toBe(true)
    }
    // Case and whitespace are normalised the way redeem normalises a typed code.
    expect(isStrongCodeFormat(' abc-123 ')).toBe(false)
  })

  // ── Fact 3, FIXED: the privileged grant now carries a second condition ──

  it('SEC25-X-03: an ssi_admin/god code from the weak keyspace is refused, not granted', () => {
    const guardIdx = redeem.indexOf("if (codeType === 'ssi_admin' || codeType === 'god') {\n    if (!isStrongCodeFormat(")
    expect(guardIdx, 'the weak-keyspace refusal must exist').toBeGreaterThan(-1)

    const grantIdx = redeem.indexOf("learnerUpdate.platform_role = 'ssi_admin'")
    expect(grantIdx).toBeGreaterThan(-1)
    // The refusal is reached BEFORE the grant, and it returns.
    expect(guardIdx).toBeLessThan(grantIdx)
    const guardBody = redeem.slice(guardIdx, redeem.indexOf('\n  }\n', guardIdx))
    expect(guardBody).toMatch(/res\.status\(200\)\.json\(\{ success: false, error: 'Invalid code' \}\)/)
    expect(guardBody).toContain('return')
  })

  it('SEC25-X-03: the refusal is indistinguishable from an unknown code', () => {
    // A distinguishable "this code is real but too weak" answer would turn the
    // refusal itself into the enumeration oracle the refusal exists to close.
    const guardIdx = redeem.indexOf("if (!isStrongCodeFormat(")
    const guardBody = redeem.slice(guardIdx, redeem.indexOf('\n  }\n', guardIdx))
    // The RESPONSE carries nothing distinguishing — the diagnosis stays server-side.
    const responseLine = guardBody.match(/res\.status\(200\)\.json\([^\n]*/)?.[0] ?? ''
    expect(responseLine).toBeTruthy()
    expect(responseLine).not.toMatch(/keyspace|weak|too short|re-?mint|privileg/i)
    // The refused attempt IS logged server-side, so an operator can see it.
    expect(guardBody).toMatch(/console\.error\([\s\S]{0,80}REFUSED/)
    // …with the code redacted, per AUTH-CORE-09.
    expect(guardBody).toContain('redactCode(inviteRow.code)')
  })

  it("SEC25-X-03: and redeem.ts's own comment still states the threat model", () => {
    // Quoted, not paraphrased. If this comment is ever softened or deleted
    // without the underlying issue staying fixed, this test is the tripwire.
    expect(redeem).toContain('sign-up is open self-service')
    expect(redeem).toContain('sweepable oracle over the ~13.8M')
    expect(redeem).toContain('it\n  // REDEEMS it (platform_role, educational_role, a govt_admins row)')
  })

  // ── And the control that is supposed to bound all of this ──

  it('the per-IP limiter is still in front of this door', () => {
    expect(redeem).toContain('isIpOverLimit')
    expect(redeem).toContain('REDEEM_PER_IP_LIMIT')
  })

  it('and its bucket key is now platform-attested, not caller-written (SEC25-A-01)', () => {
    expect(throttle).toContain("headers['x-vercel-forwarded-for']")
    expect(throttle).toMatch(/socket\s*\n?\s*\?\.remoteAddress/)
    expect(throttle).not.toMatch(/x-forwarded-for'\]\s*as string\)\?\.split\(','\)\[0\]/)
  })

  // ── the mint half, now wired ──
  //
  // ADMIN-ENT-03: `generateCodeForType()` is reached by all four invite
  // minters (api/invite/create.ts, api/groups/[id]/invites.ts,
  // api/groups/[id]/demo-mint.ts, api/admin/create-govt-admin.ts), so newly
  // minted staff codes are 128-bit. The `ssi_admin` door is closed twice over:
  // by the mint keyspace going forward, and by the redeem-side refusal above,
  // which covers every ABC-123 code already in existence.
  it('every invite minter mints privileged types at 128 bits (ADMIN-ENT-03)', () => {
    for (const file of [
      'api/invite/create.ts',
      'api/groups/[id]/invites.ts',
      'api/groups/[id]/demo-mint.ts',
      'api/admin/create-govt-admin.ts',
    ]) {
      const minterSrc = readFileSync(resolve(here, '../..', file), 'utf8')
      expect(minterSrc, file).toMatch(/generateCodeForType\(/)
      expect(minterSrc, file).not.toMatch(/\bgenerateCode\(\)/)
    }
  })
})

/** 24 consonants — I and O excluded as confusable with 1 and 0. */
const CODE_CONSONANTS_LEN = 24
