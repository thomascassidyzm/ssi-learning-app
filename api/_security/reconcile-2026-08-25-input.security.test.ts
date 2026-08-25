/**
 * AREA C RECONCILIATION (2026-08-25) — input.md findings still live on `dev`.
 *
 * Source: docs/security-audit-2026-08-11/input.md (branch `sec/audit-2026-08-11`, never merged).
 * INPUT-01's severity is UNVERIFIABLE without a live Vercel env read — see the reconciliation doc.
 * INPUT-02 and INPUT-03 already carry a still-red characterization spec on this branch
 * (api/school/class-progress.untrustedArgs.security-audit.ts, under vitest.security-audit.config.ts,
 * NOT the CI-gated suite) — a thin gated-passing mirror is added below so the finding is visible
 * under `npx vitest run -c vitest.api.config.ts` too, not only the ungated audit config.
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

describe('INPUT-02 / INPUT-03 (gated mirror): class-progress.ts constrains .or() values and allow-lists updates', () => {
  // SECURITY FINDING INPUT-02 — FIXED 2026-08-25: `.or()` takes a PostgREST
  // filter EXPRESSION, not a bound value, so an injected comma added a
  // disjunct and dissolved the forward-only position ratchet these two
  // writers exist to enforce. Both values now go through
  // api/_utils/postgrestFilter.ts (safeInteger / safeIdToken) before they are
  // interpolated, so the expression keeps exactly its two intended disjuncts.
  it('setLivePosition and setMode interpolate only sanitised values into .or()', () => {
    const src = read('api/school/class-progress.ts')
    expect(src).toMatch(/import \{ safeIdToken, safeInteger \} from '\.\.\/_utils\/postgrestFilter'/)
    expect(src).toMatch(/const safeRound = safeInteger\(roundIndex\)/)
    expect(src).toMatch(/\.or\(`last_completed_round_index\.is\.null,last_completed_round_index\.lte\.\$\{safeRound\}`\)/)
    expect(src).toMatch(/const safeLegoId = safeIdToken\(ratchetHighestTo\.legoId\)/)
    expect(src).toMatch(/\.or\(`last_completed_lego_id\.is\.null,last_completed_lego_id\.lt\.\$\{safeLegoId\}`\)/)
    // The raw caller values must not reach a filter expression anywhere.
    expect(src).not.toMatch(/\.or\(`[^`]*\$\{roundIndex\}/)
    expect(src).not.toMatch(/\.or\(`[^`]*\$\{ratchetHighestTo\.legoId\}/)
  })
  // SECURITY FINDING INPUT-03 — FIXED 2026-08-25: updateLegoProgress spread
  // the caller's raw `updates` object into the write, so the ownership check
  // in front of it could be undone by the write itself (learner_id/course_id
  // were caller-writable). The five columns @ssi/core actually updates are
  // now allow-listed, matching sibling saveLegoProgress.
  it('updateLegoProgress allow-lists the columns it writes', () => {
    const src = read('api/school/class-progress.ts')
    expect(src).not.toMatch(/\.update\(\{ \.\.\.updates,/)
    expect(src).toMatch(/\.update\(\{ \.\.\.pickLegoProgressUpdates\(updates\), updated_at:/)
    const allowlist = src.slice(src.indexOf('UPDATABLE_LEGO_PROGRESS_COLUMNS = ['))
    expect(allowlist).not.toMatch(/^[\s\S]{0,200}'learner_id'/)
    expect(allowlist).not.toMatch(/^[\s\S]{0,200}'course_id'/)
  })
})

describe('INPUT-04: /api/player-events attributes events only from a verified bearer', () => {
  // SECURITY FINDING INPUT-04 — FIXED 2026-08-25: without a bearer the
  // handler trusted the `ssi-user-id` cookie (uuid-shape checked only) and
  // inserted with the service-role key, so anyone could fabricate events
  // against ANY learner's uuid. Attribution now comes from a VERIFIED bearer;
  // the cookie is honoured only for play-as-class, and only when the verified
  // caller's visible scope actually contains that class. Unauthenticated
  // batches still insert (guest telemetry is a real path) — unattributed.
  it('the no-bearer path attributes null instead of trusting the ssi-user-id cookie', () => {
    const src = read('api/player-events.ts')
    expect(src).toMatch(/if \(!authHeader \|\| !authHeader\.startsWith\('Bearer '\)\) return null/)
    expect(src).not.toMatch(/return rawUserId && UUID_RE\.test\(rawUserId\) \? rawUserId : null/)
    // The one cookie path left is gated on an authorisation check.
    expect(src).toMatch(/isAuthorisedClassLearner\(supabase, result\.userId, cookieId\)/)
    expect(src).toMatch(/scope\.classIds\.includes\(cls\.id as string\)/)
  })
})

describe('INPUT-06 / COORD-01: admin/users.ts escapes the search param before it reaches .or()', () => {
  // SECURITY FINDING INPUT-06 / COORD-01 — FIXED 2026-08-25: `search` was
  // interpolated unescaped into an .or() filter expression evaluated with RLS
  // bypassed (service-role client). It now goes through the shared
  // quoteFilterValue() (PostgREST's own double-quote escape, so the term
  // itself still searches exactly as before) and is length-capped.
  it('users.ts escapes `search` with quoteFilterValue and caps its length', () => {
    const src = read('api/admin/users.ts')
    expect(src).not.toMatch(/const orParts = \[`display_name\.ilike\.%\$\{search\}%`\]/)
    expect(src).toMatch(/import \{ quoteFilterValue \} from '\.\.\/_utils\/postgrestFilter'/)
    expect(src).toMatch(/const orParts = \[`display_name\.ilike\.\$\{quoteFilterValue\(`%\$\{search\}%`\)\}`\]/)
    expect(src).toMatch(/req\.query\.search\.trim\(\)\.slice\(0, 100\)/)
  })
})

describe('INPUT-07: /api/email/verify still throws an unhandled TypeError on a non-string email', () => {
  // SECURITY FINDING INPUT-07: `email.toLowerCase()` sits outside the try
  // block, so a shaped body ({email: {...}}) throws a raw TypeError out of
  // the handler — an opaque 500 with a stack trace in the logs.
  it('normalizedEmail is still computed with no typeof check, before the try block', () => {
    const src = read('api/email/verify.ts')
    const normalizeIdx = src.indexOf('const normalizedEmail = email.toLowerCase().trim()')
    const tryIdx = src.indexOf('try {')
    expect(normalizeIdx).toBeGreaterThan(-1)
    expect(tryIdx).toBeGreaterThan(-1)
    expect(normalizeIdx).toBeLessThan(tryIdx)
    expect(src.slice(0, normalizeIdx)).not.toMatch(/typeof email/)
  })
  it.todo('SECURE: type-check email/token as strings and 400 otherwise')
})

describe('INPUT-08: the audio proxy 502 body is caller-safe', () => {
  // SECURITY FINDING INPUT-08 — FIXED 2026-08-25: an anonymous caller who
  // triggered any S3 failure received the internal object key and the AWS
  // error text/code (which routinely carries the bucket ARN and key-prefix
  // layout). The body is now a fixed string; the detail stays in the
  // console.error immediately above it.
  it('[audioId].ts 502 body carries no details or key field', () => {
    const src = read('api/audio/[audioId].ts')
    expect(src).toMatch(/status\(502\)\.json\(\{ error: 'Failed to fetch audio from storage' \}\)/)
    expect(src).not.toMatch(/status\(502\)\.json\(\{[\s\S]{0,200}details:/)
    expect(src).not.toMatch(/status\(502\)\.json\(\{[\s\S]{0,200}key: sample\.s3_key/)
  })
})

describe('INPUT-09: free text reaching the DB is typed and length-capped', () => {
  // SECURITY FINDING INPUT-09 — FIXED 2026-08-25: course_code and
  // client_version had no type check and no length cap (contrast event_type,
  // correctly .slice(0, 64)); class_name was type-checked but never capped
  // anywhere it is written. Both now follow the
  // typeof === 'string' ? x.slice(0, N) : null pattern.
  it('player-events.ts type-checks and caps course_code/client_version', () => {
    const src = read('api/player-events.ts')
    expect(src).not.toContain('course_code: e.course_code || null')
    expect(src).not.toContain('client_version: e.client_version || null')
    expect(src).toContain("typeof e.course_code === 'string' ? e.course_code.slice(0, 64) || null : null")
    expect(src).toContain("typeof e.client_version === 'string' ? e.client_version.slice(0, 64) || null : null")
  })
  it('class_name writers cap the value they persist', () => {
    for (const file of ['api/school/rename-class.ts', 'api/teacher/classes.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/class_name.*\.slice\(0,\s*\d+\)/)
    }
  })
})

describe('INPUT-11: an unauthenticated request body still drives an outbound DNS lookup', () => {
  // SECURITY FINDING INPUT-11: hasMxRecord() runs dns.resolveMx on a
  // caller-supplied domain from possession-redeem, with no rate limit ahead
  // of the lookup — a low-bandwidth beacon/amplification lever from the
  // serverless egress IP.
  it('hasMxRecord is called with no rate-limit gate ahead of it in possession-redeem.ts', () => {
    const emailValidation = read('api/_utils/emailValidation.ts')
    expect(emailValidation).toContain('dns.resolveMx(domain)')
    const redeem = read('api/auth/possession-redeem.ts')
    // The throttle in this file keys on invite-code attempts, not on the MX lookup itself.
    expect(redeem).toContain('hasMxRecord')
  })
  it.todo('SECURE: rate-limit per IP ahead of the MX lookup; keep the fail-open semantics')
})

describe('INPUT-12: cron secret comparison is constant-time and fails closed on every deployed env', () => {
  // SECURITY FINDING INPUT-12 — FIXED 2026-08-25: `authHeader !== \`Bearer
  // ${cronSecret}\`` was a plain string compare, and when CRON_SECRET was
  // unset AND VERCEL_ENV was not exactly 'production' (an unconfigured
  // preview, a self-hosted deploy) the auth check was skipped entirely.
  // Both handlers now call the shared checkCronAuth(), which compares with
  // crypto.timingSafeEqual and refuses to run un-authenticated anywhere
  // VERCEL_ENV is set at all. Only a local run is still allowed through.
  it('both cron handlers delegate to the shared constant-time checkCronAuth()', () => {
    for (const file of ['api/cron/expire-demo-schools.ts', 'api/cron/teacher-payouts.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/import \{ checkCronAuth \} from '\.\.\/_utils\/cronAuth'/)
      expect(src, file).toMatch(/const cronAuth = checkCronAuth\(\(req\.headers\.authorization \|\| ''\)\.trim\(\), cronSecret\)/)
      expect(src, file).toMatch(/if \(!cronAuth\.ok\)/)
      expect(src, file).not.toMatch(/authHeader !== `Bearer \$\{cronSecret\}`/)
    }
  })
  it('the shared helper compares in constant time and treats any VERCEL_ENV as deployed', () => {
    const src = read('api/_utils/cronAuth.ts')
    expect(src).toContain("import { timingSafeEqual } from 'node:crypto'")
    expect(src).toMatch(/return timingSafeEqual\(got, expected\)/)
    expect(src).toMatch(/Boolean\(\(process\.env\.VERCEL_ENV \|\| ''\)\.trim\(\)\)/)
    // Unset secret on a deployed environment is a refusal, not a skip.
    expect(src).toMatch(/return \{ ok: false, status: 500, error: 'CRON_SECRET not configured' \}/)
  })
})
