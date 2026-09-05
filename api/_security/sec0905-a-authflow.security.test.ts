/**
 * SEC0905-A — the passwordless sign-in / access-code auth flow.
 *
 * Full writeup: docs/security-audit-2026-09-05/area-a-authflow.md
 *
 * These are CHARACTERIZATION tests: they document CURRENT (in places,
 * vulnerable) behaviour by reading the source, so a future fix flips them
 * red on purpose. That is the point — they are the regression guard for the
 * fix, not a claim that today's behaviour is correct. Each `it()` says which
 * outcome it wants explicitly.
 *
 * SEC0905-A-02 (CRITICAL, characterization — will go red when fixed): the
 * empty-shell adoption path in possession-redeem.ts binds the mint to
 * whichever email the caller typed and whichever eligible invite code they
 * hold, with NO relationship required between the two, and NO proof of
 * mailbox receipt for that email. Combined with the fact that a "shell"
 * account (never signed in, unconfirmed) is a state ANY caller can produce
 * for ANY email address with one call to send-code.ts (or Supabase's own
 * public signInWithOtp), this is an account-pre-hijacking primitive: know a
 * victim's email, hold any cheap eligible code (e.g. a shared student join
 * code), get a session as that email. See the report for the full chain.
 *
 * SEC0905-A-01 (HIGH, characterization — will go red when fixed):
 * staff-signin-link.ts's cross-school containment check reads only
 * `user_tags` for "does the target reach a second school?" and never
 * queries `schools.admin_user_id` — the exact second spelling of school
 * admin-ship this codebase has already shipped two incidents about
 * (documented in api/_utils/schoolStaff.ts's own header).
 *
 * SEC0905-A-04 through A-07 are SECURE-ASSERTIONS: properties that hold
 * today and should keep holding. They go red if a future change regresses
 * them, which is the intended behaviour of a secure-assertion.
 *
 * Nothing here touches a database or a network — everything is a read of
 * the committed source.
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

describe('SEC0905-A-02: possession-redeem.ts shell adoption has no code<->email binding', () => {
  const src = read('auth/possession-redeem.ts')

  it('characterization: tryAdoptShellAccount decides purely from the auth-user/learner row for the TYPED email — no invite-code identity check', () => {
    const start = src.indexOf('async function tryAdoptShellAccount')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\nexport default async function handler')
    const body = src.slice(start, end)

    // The only gates: prior sign-in, confirmed email, and existing role/invite
    // on the learner row. None of them reference the invite code at all.
    expect(body).toMatch(/user\.last_sign_in_at/)
    expect(body).toMatch(/user\.email_confirmed_at/)
    expect(body).toMatch(/educational_role \|\| learner\.platform_role \|\| learner\.invite_code_id/)
    // The function signature itself proves it: it is never handed the invite
    // row, the code, or the code's type — only supabase + the typed email.
    expect(body).toMatch(/async function tryAdoptShellAccount\(\s*supabase: SupabaseClient,\s*email: string,\s*\)/)
  })

  it('characterization: the eligible-code-type set includes "student" and is not narrowed for the adoption branch', () => {
    // Any code of any eligible type reaches tryAdoptShellAccount — the
    // adoption call site is downstream of the single shared eligibility
    // check, not a stricter one.
    expect(src).toMatch(/POSSESSION_ELIGIBLE_CODE_TYPES = new Set\(\[\s*'teacher',\s*'school_admin',\s*'school_admin_join',\s*'govt_admin',\s*'student',\s*\]\)/)
    const eligibilityIdx = src.indexOf('POSSESSION_ELIGIBLE_CODE_TYPES.has')
    const adoptionCallIdx = src.indexOf('tryAdoptShellAccount(supabase, normalizedEmail)')
    expect(eligibilityIdx).toBeGreaterThan(-1)
    expect(adoptionCallIdx).toBeGreaterThan(eligibilityIdx)
    // Only the `personal` branch (a distinct, earlier code path keyed on
    // metadata.personal_auth_user_id) binds a code to one specific account.
    // It returns before reaching createUser/adoption, so it can never be
    // confused with the general path adoption lives in.
    const personalReturnIdx = src.indexOf("res.status(200).json({\n        success: true,\n        personal: true,")
    expect(personalReturnIdx).toBeGreaterThan(-1)
    expect(personalReturnIdx).toBeLessThan(adoptionCallIdx)
  })

  it('characterization: adoption never checks that the caller (or anyone) proved receipt of mail at the typed email', () => {
    const start = src.indexOf('async function tryAdoptShellAccount')
    const end = src.indexOf('\nexport default async function handler')
    const body = src.slice(start, end)
    // No OTP-to-this-address verification, no MX/ownership re-check, no
    // correlation with who created the shell or when.
    expect(body).not.toMatch(/verifyOtp\(\{[^}]*email/)
    expect(body).not.toMatch(/created_at/)
  })

  it('send-code.ts documents, in its own words, that minting for an unknown address CREATES the auth user — the precondition an attacker manufactures', () => {
    const sendCode = read('auth/send-code.ts')
    expect(sendCode).toMatch(/minting for an address with no account[\s\S]{0,10}CREATES the account/)
  })
})

describe('SEC0905-A-01: staff-signin-link.ts containment checks user_tags only, never schools.admin_user_id', () => {
  const src = read('school/staff-signin-link.ts')

  it('characterization: the second-school ("reachesElsewhere") check queries only user_tags', () => {
    const start = src.indexOf('Staff at a SECOND school reach outside')
    const end = src.indexOf('reachesElsewhere', start) + 400
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, end)
    expect(block).toMatch(/\.from\('user_tags'\)/)
    // The one other table this file ever selects `admin_user_id` from is
    // `schools`, and it is used ONLY to resolve the CALLER's own school
    // (callerAdminSchoolId), never to check the TARGET for a second school.
    expect(block).not.toMatch(/admin_user_id/)
  })

  it("callerAdminSchoolId checks both schools.admin_user_id and the user_tags spelling for the CALLER, proving the codebase knows both spellings exist", () => {
    const fnStart = src.indexOf('async function callerAdminSchoolId')
    const fnEnd = src.indexOf('\nexport default async function handler')
    const body = src.slice(fnStart, fnEnd)
    expect(body).toMatch(/\.from\('schools'\)[\s\S]*?admin_user_id/)
    expect(body).toMatch(/\.from\('user_tags'\)/)
  })

  it('schoolStaff.ts documents two prior incidents caused by exactly this admin_user_id/user_tags divergence', () => {
    const schoolStaff = read('_utils/schoolStaff.ts')
    expect(schoolStaff).toMatch(/Chepstow/)
    expect(schoolStaff).toMatch(/Harbour Leader/)
    // isSchoolAdminOf is the codebase's own fix for this divergence — proof
    // a same-shaped helper already exists and staff-signin-link.ts does not
    // use it for the target/second-school side of its containment check.
    expect(schoolStaff).toMatch(/export async function isSchoolAdminOf/)
    expect(src).not.toMatch(/isSchoolAdminOf/)
  })

  it('the existing "DIFFERENT school" containment test constructs only a user_tags scenario for the target, never a second schools.admin_user_id', () => {
    const testSrc = read('school/staff-signin-link.test.ts')
    const titleIdx = testSrc.indexOf('403 CONTAINMENT: refuses a target who also holds an active school tag for a DIFFERENT school')
    expect(titleIdx).toBeGreaterThan(-1)
    const bodyEnd = testSrc.indexOf('\n  })', titleIdx)
    const body = testSrc.slice(titleIdx, bodyEnd)
    // It only ever sets up a second user_tags row (targetOtherTags); it never
    // mocks a second `schools` row pointing admin_user_id at the target.
    expect(body).toMatch(/targetOtherTags = \[/)
    expect(body).not.toMatch(/admin_user_id/)
  })
})

describe('SEC0905-A-03: staff_access_codes has no migration in the repo', () => {
  it('characterization: no migration file defines staff_access_codes', () => {
    const { readdirSync } = require('node:fs')
    const migrationsDir = join(__dirname, '..', '..', 'supabase', 'migrations')
    const files: string[] = readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql'))
    const hit = files.find((f) => {
      const body = readFileSync(join(migrationsDir, f), 'utf-8')
      return body.includes('staff_access_codes')
    })
    expect(hit).toBeUndefined()
  })

  it('characterization: schema.sql does not mention staff_access_codes either', () => {
    const schemaPath = join(__dirname, '..', '..', 'supabase', 'schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    expect(schema).not.toMatch(/staff_access_codes/)
  })

  it('both dependent endpoints nonetheless assume the table exists and is service-role-scoped', () => {
    const redeem = read('auth/access-code-redeem.ts')
    const mint = read('school/staff-signin-link.ts')
    expect(redeem).toMatch(/\.from\('staff_access_codes'\)/)
    expect(mint).toMatch(/\.from\('staff_access_codes'\)/)
    // Verified live 2026-09-05 (read-only, see report): the table exists in
    // production with a matching column set, and anon has NO grant
    // (401/42501) — this test only pins what the repo can see; the live
    // grant check is not repeatable from a unit test and is not asserted
    // here.
  })
})

describe('SEC0905-A-04/05/06/07: secure-assertions for the new auth-flow files', () => {
  it('A-04: accessCode.ts uses crypto.randomInt (CSPRNG), never Math.random, for an 8-char/30-symbol code', () => {
    const src = read('_utils/accessCode.ts')
    expect(src).toMatch(/import \{ createHash, randomInt \} from 'crypto'/)
    expect(src).toMatch(/ACCESS_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'/)
    expect(src).toMatch(/ACCESS_CODE_LENGTH = 8/)
    // Math.random() is named twice, only in doc-comment prose explaining why
    // it's rejected in favour of randomInt — assert it never appears outside
    // a /** */ comment, i.e. never as an actual call in real code.
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/Math\.random/)
    // 30^8 keyspace, stated as a fact this test locks in.
    expect(Math.pow(30, 8)).toBe(656100000000)
  })

  it('A-04: REDEEM_PER_IP_LIMIT bounds blind guessing to ~1-in-28M over a code\'s full 48h life', () => {
    const throttle = read('_utils/codeAttemptThrottle.ts')
    expect(throttle).toMatch(/REDEEM_PER_IP_LIMIT = 120/)
    const accessCode = read('_utils/accessCode.ts')
    expect(accessCode).toMatch(/ACCESS_CODE_TTL_MS = 48 \* 60 \* 60 \* 1000/)
    const windowsIn48h = (48 * 60) / 15 // 15-minute windows
    const maxGuesses = 120 * windowsIn48h
    expect(maxGuesses).toBe(23040)
    const keyspace = Math.pow(30, 8)
    const oddsOfHit = maxGuesses / keyspace
    expect(oddsOfHit).toBeLessThan(1 / 28_000_000)
  })

  it('A-05: send-code.ts and access-code-redeem.ts both source their IP from the SEC25-A-01-fixed getClientIp, never a client header directly', () => {
    const sendCode = read('auth/send-code.ts')
    const redeem = read('auth/access-code-redeem.ts')
    expect(sendCode).toMatch(/import \{ getClientIp \} from '\.\.\/_utils\/codeAttemptThrottle'/)
    expect(redeem).toMatch(/getClientIp,/)
    expect(redeem).toMatch(/from '\.\.\/_utils\/codeAttemptThrottle'/)
    // Neither file reads a client header directly — `x-forwarded-for` is
    // named only in send-code.ts's prose citing SEC0901-A-04, never as an
    // actual `headers[...]` read in either file.
    expect(sendCode).not.toMatch(/headers\[['"]x-forwarded-for['"]\]/)
    expect(redeem).not.toMatch(/x-forwarded-for/)
  })

  it('A-06: the redeem claim is one atomic UPDATE gated on redeemed_at IS NULL AND expires_at > now, not read-then-write', () => {
    const src = read('auth/access-code-redeem.ts')
    const updateIdx = src.indexOf(".update({ redeemed_at: nowIso, redeemed_ip_hash: ipHash })")
    expect(updateIdx).toBeGreaterThan(-1)
    const clause = src.slice(updateIdx, updateIdx + 300)
    expect(clause).toMatch(/\.eq\('code_hash', codeHash\)/)
    expect(clause).toMatch(/\.is\('redeemed_at', null\)/)
    expect(clause).toMatch(/\.gt\('expires_at', nowIso\)/)
  })

  it('A-06: unknown, expired and already-used codes share one refusal string (no oracle)', () => {
    const src = read('auth/access-code-redeem.ts')
    const refusalDecl = src.match(/const REFUSAL =\s*\n?\s*'([^']+)'/)
    expect(refusalDecl).toBeTruthy()
    // Exactly one refusal string constant is used for the not-claimed case —
    // there is no second/third string differentiating unknown vs expired vs used.
    const refusalUses = (src.match(/error: REFUSAL/g) || []).length
    expect(refusalUses).toBe(1)
  })

  it('A-07: signInCodeEmail.ts escapes both interpolated values and never logs the raw code', () => {
    const template = read('_utils/signInCodeEmail.ts')
    expect(template).toMatch(/function esc\(s: string\)/)
    expect(template).toMatch(/\$\{esc\(code\)\}/)
    expect(template).toMatch(/\$\{esc\(lines\.lead\)\}/) // lead embeds `recipient`
    const sendCode = read('auth/send-code.ts')
    expect(sendCode).not.toMatch(/console\.\w+\([^)]*code[^)]*\)/)
  })
})
