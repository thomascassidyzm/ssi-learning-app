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

describe('SEC0905-A-02: possession-redeem.ts shell adoption is bound to the invite that made the shell', () => {
  const src = read('auth/possession-redeem.ts')

  // FIXED 2026-09-05 by the account-pre-hijacking hotfix (api/_utils/shellClaim.ts).
  // The three tests below were characterizations of the vulnerable shape; they
  // are now SECURE-ASSERTIONS of the fix, and go red if the binding is removed.

  it('A-02 FIXED: tryAdoptShellAccount is handed the invite code id and refuses any shell this invite did not create', () => {
    const start = src.indexOf('async function tryAdoptShellAccount')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\nexport default async function handler')
    const body = src.slice(start, end)

    // The old gates (prior sign-in, confirmed email, existing role) still stand…
    expect(body).toMatch(/user\.last_sign_in_at/)
    expect(body).toMatch(/user\.email_confirmed_at/)
    expect(body).toMatch(/educational_role \|\| learner\.platform_role \|\| learner\.invite_code_id/)
    // …but they are no longer the ONLY gates. The signature now carries the
    // invite code id, and the claim check is what makes the code<->email
    // binding exist at all. This is the finding's fix, asserted directly.
    expect(body).toMatch(
      /async function tryAdoptShellAccount\(\s*supabase: SupabaseClient,\s*email: string,\s*inviteCodeId: string,\s*\)/,
    )
    expect(body).toMatch(/if \(!shellClaimMatches\([\s\S]{0,200}?inviteCodeId\)\) return null/)
  })

  it('A-02 FIXED: the shell-creating path stamps the claim, and adoption spends it', () => {
    // Creation stamps app_metadata (service-role-writable only) with the
    // invite id; adoption clears it in the same patch, so one shell is
    // adopted at most once.
    expect(src).toMatch(/import \{ buildShellClaim, clearedShellClaim, shellClaimMatches \} from '\.\.\/_utils\/shellClaim'/)
    expect(src).toMatch(/app_metadata: buildShellClaim\(inviteRow\.id as string\)/)
    expect(src).toMatch(/app_metadata: clearedShellClaim\(/)
    // The eligible-code-type set is still the single shared gate — the
    // narrowing that closed the finding is the claim, not the code type.
    expect(src).toMatch(
      /POSSESSION_ELIGIBLE_CODE_TYPES = new Set\(\[\s*'teacher',\s*'school_admin',\s*'school_admin_join',\s*'govt_admin',\s*'student',\s*\]\)/,
    )
    const eligibilityIdx = src.indexOf('POSSESSION_ELIGIBLE_CODE_TYPES.has')
    const adoptionCallIdx = src.indexOf('tryAdoptShellAccount(supabase, normalizedEmail, inviteRow.id as string)')
    expect(eligibilityIdx).toBeGreaterThan(-1)
    expect(adoptionCallIdx).toBeGreaterThan(eligibilityIdx)
    // The `personal` branch still returns before ever reaching adoption.
    const personalReturnIdx = src.indexOf("res.status(200).json({\n        success: true,\n        personal: true,")
    expect(personalReturnIdx).toBeGreaterThan(-1)
    expect(personalReturnIdx).toBeLessThan(adoptionCallIdx)
  })

  it('A-02 FIXED: adoption still proves no mailbox receipt — the claim, not the mailbox, is what binds', () => {
    const start = src.indexOf('async function tryAdoptShellAccount')
    const end = src.indexOf('\nexport default async function handler')
    const body = src.slice(start, end)
    // There is still no OTP-to-this-address verification and no correlation
    // with who asked for the shell. That is deliberate and now safe: the
    // app_metadata claim names the invite this exact flow created it for, and
    // only the service role can write it.
    expect(body).not.toMatch(/verifyOtp\(\{[^}]*email/)
    expect(body).not.toMatch(/created_at/)
    expect(body).toMatch(/shellClaimMatches/)
  })

  it('send-code.ts documents, in its own words, that minting for an unknown address CREATES the auth user — the precondition the claim now neutralises', () => {
    const sendCode = read('auth/send-code.ts')
    expect(sendCode).toMatch(/minting for an address with no account[\s\S]{0,10}CREATES the account/)
  })
})

describe('SEC0905-A-01: staff-signin-link.ts containment sees every spelling of reach', () => {
  const src = read('school/staff-signin-link.ts')

  // FIXED 2026-09-05 by the staff-signin-link containment fix (schoolReachOf).
  // These were characterizations of the tags-only check; they are now
  // SECURE-ASSERTIONS of the union, and go red if any spelling is dropped.

  it('A-01 FIXED: the second-school ("reachesElsewhere") check runs on schoolReachOf, not a hand-rolled user_tags read', () => {
    const start = src.indexOf('A SECOND school outside the caller')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('reachesElsewhere', start) + 400
    const block = src.slice(start, end)
    expect(block).toMatch(/targetReach\.some/)
    // The block does no table access of its own at all — that is the fix: one
    // resolver owns every spelling, so no call site can miss one.
    expect(block).not.toMatch(/\.from\(/)
    expect(src).toMatch(/const targetReach = await schoolReachOf\(supabase, targetUserId\)/)
    expect(src).toMatch(/schoolReachOf,/)
  })

  it('A-01 FIXED: schoolReachOf unions all three spellings — admin_user_id, SCHOOL: tags of ANY role, and CLASS: tags resolved to their school', () => {
    const schoolStaff = read('_utils/schoolStaff.ts')
    const start = schoolStaff.indexOf('export async function schoolReachOf')
    expect(start).toBeGreaterThan(-1)
    const body = schoolStaff.slice(start)
    // Spellings 1+2 come via schoolMembershipsOf (which reads schools.admin_user_id
    // and staff SCHOOL: tags); this function then widens tags to non-staff roles
    // and adds class tags.
    expect(body).toMatch(/schoolMembershipsOf\(supabase, authUid\)/)
    expect(body).toMatch(/\.eq\('tag_type', 'school'\)/)
    expect(body).toMatch(/\.eq\('tag_type', 'class'\)/)
    expect(body).toMatch(/\.from\('classes'\)\s*\.select\('id, school_id'\)/)
    const memberships = schoolStaff.slice(
      schoolStaff.indexOf('export async function schoolMembershipsOf'),
      start,
    )
    expect(memberships).toMatch(/\.from\('schools'\)[\s\S]*?admin_user_id/)
    expect(memberships).toMatch(/\.from\('user_tags'\)/)
  })

  it("A-01 FIXED: the caller's own adminship resolves through the same staff resolver, so both sides of the comparison see both spellings", () => {
    const fnStart = src.indexOf('async function callerAdminSchoolId')
    const fnEnd = src.indexOf('\nexport default async function handler')
    const body = src.slice(fnStart, fnEnd)
    expect(body).toMatch(/schoolMembershipsOf\(svc, authUid\)/)
    // No hand-rolled table reads left on this side either.
    expect(body).not.toMatch(/\.from\(/)
  })

  it('schoolStaff.ts still documents the two prior incidents this divergence caused', () => {
    const schoolStaff = read('_utils/schoolStaff.ts')
    expect(schoolStaff).toMatch(/Chepstow/)
    expect(schoolStaff).toMatch(/Harbour Leader/)
    expect(schoolStaff).toMatch(/export async function isSchoolAdminOf/)
  })

  it('A-01 FIXED: the containment test suite now constructs a second schools.admin_user_id target, and pupil reach too', () => {
    const testSrc = read('school/staff-signin-link.test.ts')
    // The founding-admin scenario the tags-only check could not see.
    expect(testSrc).toMatch(
      /403s: the target ALSO founds another school via schools\.admin_user_id and carries no tag for it/,
    )
    expect(testSrc).toMatch(/ownedSchools = \{ 'admin-1': \['school-1'\], 'target-1': \['school-2'\] \}/)
    // The pupil-seat scenario the staff-only view could not see.
    expect(testSrc).toMatch(/403s: the target teaches here and is TAGGED A PUPIL at another school/)
    expect(testSrc).toMatch(/403s: the target teaches here and holds a pupil CLASS tag at another school/)
    // …and the negative case, so containment did not become "refuse everyone".
    expect(testSrc).toMatch(/200: a pupil CLASS tag INSIDE the caller\\'s own school is not reach elsewhere/)
  })
})

describe('SEC0905-A-03: staff_access_codes has no migration in the repo (residual)', () => {
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

  it('PARTLY CLOSED: schema.sql now records the table, with RLS on and a service_role-only grant', () => {
    // The snapshot was regenerated after the audit (a7384811, "10 tables the
    // snapshot had been missing"), so the repo can now SEE the table's shape,
    // its RLS posture and its grants. That closes the visibility half of A-03.
    // The residual — no migration file creates it, so a fresh environment
    // cannot be built from the repo — is still pinned by the test above.
    const schemaPath = join(__dirname, '..', '..', 'supabase', 'schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    expect(schema).toMatch(/CREATE TABLE public\.staff_access_codes/)
    expect(schema).toMatch(/ALTER TABLE public\.staff_access_codes ENABLE ROW LEVEL SECURITY/)
    expect(schema).toMatch(/GRANT ALL ON TABLE public\.staff_access_codes TO service_role/)
    // No anon/authenticated grant — the endpoints are service-role-scoped.
    const aclStart = schema.indexOf('-- Name: TABLE staff_access_codes; Type: ACL')
    expect(aclStart).toBeGreaterThan(-1)
    const acl = schema.slice(aclStart, aclStart + 400)
    expect(acl).not.toMatch(/TO anon/)
    expect(acl).not.toMatch(/TO authenticated/)
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
