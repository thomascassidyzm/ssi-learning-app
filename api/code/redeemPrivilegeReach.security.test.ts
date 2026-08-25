/**
 * SEC25-X-03 — what the bypassable throttle on `api/code/redeem.ts` is actually
 * standing in front of. **Coordinator escalation of SEC25-A-01.**
 *
 * Area A (#467) found that the new shared limiter `_utils/codeAttemptThrottle.ts`
 * carries the SEC-AUDIT-2026-08-18 Finding 5 shape into its own bucket key —
 * `getClientIp()` reads the leftmost `X-Forwarded-For` entry or `X-Real-IP`,
 * both of which the caller writes, with no platform-attested fallback — and
 * rated it "low (confirmation)", on the grounds that the module's own docstring
 * says Finding 5 was deliberately left open.
 *
 * That rating is too low, and this file is why. Three facts compose, and no
 * single area of the audit could see all three:
 *
 *   1. `redeem.ts` is the grant path for `platform_role = 'ssi_admin'`. A code
 *      of type `ssi_admin` (or the legacy `god`) sets full platform privilege
 *      on the redeemer. It is not merely an affiliation endpoint.
 *   2. Every invite code — INCLUDING the `ssi_admin` type — is minted by the
 *      one shared `generateCode()` in the ABC-123 format. 24 consonants ^3 x
 *      10^3 = 13,824,000. The 2026-08-11 audit's AUTH-CORE-01 already called
 *      that keyspace reachable by patience; this pins that privileged codes get
 *      no larger keyspace than a student code, even though `codeGen.ts` proves
 *      the authors know how to mint a 128-bit one — `generateShareCode()` is
 *      right there in the same file, used for board share links.
 *   3. There is no second factor at redemption. No PIN, no email challenge, no
 *      out-of-band step gates a privileged code type over an ordinary one.
 *
 * So the ONLY control bounding an attacker who guesses codes against the
 * highest-privilege grant in the system is `REDEEM_PER_IP_LIMIT`, and area A
 * demonstrated that its bucket key is chosen by the attacker. That is not a
 * confirmation of a known low — it is the anti-enumeration control on the
 * `ssi_admin` door, and it does not bind.
 *
 * Honest scoping, so this is not read as more novel than it is: the bucket-key
 * weakness is 2026-08-18's Finding 5, and the unmetered-redemption concern is
 * 2026-08-11's AUTH-CORE-01 (rated high, "costs an attacker patience"). Neither
 * is new. What is new is that they are the same door, that the door reaches
 * `ssi_admin`, and that the limiter added since — the one thing that looked
 * like a fix — does not close it. Exploitation additionally requires an active
 * `ssi_admin`-type code to exist, which this audit made NO live check for; see
 * the gaps section of the README.
 *
 * Nothing here touches a database or a network — every assertion reads source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

const redeem = src('redeem.ts')
const codeGen = src('../_utils/codeGen.ts')
const throttle = src('../_utils/codeAttemptThrottle.ts')

describe('SEC25-X-03: the reach of the endpoint behind the bypassable throttle', () => {
  // ── Fact 1: redeem grants full platform privilege ──

  it('redeem.ts sets platform_role = ssi_admin for the ssi_admin/god code types', () => {
    expect(redeem).toMatch(/codeType === 'ssi_admin' \|\| codeType === 'god'/)
    expect(redeem).toContain("learnerUpdate.platform_role = 'ssi_admin'")
  })

  it('and that update is applied to the redeeming account', () => {
    expect(redeem).toMatch(/\.from\('learners'\)\s*\n?\s*\.update\(learnerUpdate\)/)
  })

  // ── Fact 2: privileged codes share the small keyspace ──

  it('there is exactly ONE code minter, and it is the ABC-123 format', () => {
    // If a privileged-code minter is ever added, this test should be the thing
    // that makes someone justify its keyspace.
    expect(codeGen).toContain("const CODE_CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'")
    expect(CODE_CONSONANTS_LEN ** 3 * 10 ** 3).toBe(13_824_000)
  })

  it('a 128-bit minter exists in the same file and is NOT used for invite codes', () => {
    // generateShareCode() is the capability-by-unguessability model, applied to
    // board share links. The asymmetry is the finding: the weakest keyspace
    // guards the strongest grant.
    expect(codeGen).toContain('generateShareCode')
    expect(codeGen).toContain('randomBytes(16)')
    expect(redeem, 'redeem must not have quietly gained a stronger code path')
      .not.toContain('generateShareCode')
  })

  // ── Fact 3: no second factor ──

  // SECURITY FINDING SEC25-X-03: characterises today's behaviour — a privileged
  // code type passes through exactly the same redemption path as a student
  // code. The branch that grants `ssi_admin` is selected on `codeType` alone;
  // there is no additional condition, no out-of-band step, nothing a privileged
  // type must satisfy that a student type need not. Passes today; goes red when
  // a second factor is added for privileged types, which is the fix this names.
  //
  // The one gate that does exist before this point is a bearer token — and the
  // handler's own comment is explicit that this is not a cost, because sign-up
  // is open self-service OTP. That comment is asserted below rather than
  // paraphrased: the authors already reached this conclusion, which is the
  // strongest possible corroboration and the reason this is an escalation of
  // severity rather than a disclosure.
  it('SEC25-X-03: the ssi_admin branch is selected on codeType alone', () => {
    const i = redeem.indexOf("learnerUpdate.platform_role = 'ssi_admin'")
    expect(i).toBeGreaterThan(-1)
    // The whole guard, verbatim: a code-type equality and nothing else.
    const guard = redeem.slice(redeem.lastIndexOf('if (', i), i)
    expect(guard).toMatch(/^if \(codeType === 'ssi_admin' \|\| codeType === 'god'\) \{/)
    for (const extra of ['&&', 'await', 'verified', 'confirm']) {
      expect(guard, `the ssi_admin guard carries no ${extra} condition`).not.toContain(extra)
    }
  })

  it("SEC25-X-03: and redeem.ts's own comment already states the threat model", () => {
    // Quoted, not paraphrased. If this comment is ever softened or deleted
    // without the underlying issue being fixed, this test is the tripwire.
    expect(redeem).toContain('sign-up is open self-service')
    expect(redeem).toContain('sweepable oracle over the ~13.8M')
    expect(redeem).toContain('it\n  // REDEEMS it (platform_role, educational_role, a govt_admins row)')
  })

  it.todo(
    'SEC25-X-03 fixed: an ssi_admin/god code either mints from a 128-bit ' +
      'keyspace, or requires an out-of-band confirmation at redemption'
  )

  // ── And the control that is supposed to bound all of this ──

  it('the only anti-enumeration control on this door is the per-IP limiter', () => {
    expect(redeem).toContain('isIpOverLimit')
    expect(redeem).toContain('REDEEM_PER_IP_LIMIT')
  })

  it('whose bucket key the caller writes — SEC25-A-01, restated as the reason this matters', () => {
    expect(throttle).toContain("headers['x-forwarded-for']")
    expect(throttle).not.toContain('x-vercel-forwarded-for')
    expect(throttle).not.toContain('socket.remoteAddress')
  })
})

/** 24 consonants — I and O excluded as confusable with 1 and 0. */
const CODE_CONSONANTS_LEN = 24
