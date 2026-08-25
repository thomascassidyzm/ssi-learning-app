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

describe('INPUT-02 / INPUT-03 (gated mirror): class-progress.ts still interpolates .or() filters and spreads untyped updates', () => {
  // SECURITY FINDING INPUT-02: `.or()` takes a PostgREST filter EXPRESSION, not
  // a bound value — an injected comma adds a disjunct, defeating the
  // forward-only position ratchet these two writers exist to enforce.
  it('setLivePosition and setMode still interpolate roundIndex/legoId into .or() template literals', () => {
    const src = read('api/school/class-progress.ts')
    expect(src).toMatch(/\.or\(`last_completed_round_index\.is\.null,last_completed_round_index\.lte\.\$\{roundIndex\}`\)/)
    expect(src).toMatch(/\.or\(`last_completed_lego_id\.is\.null,last_completed_lego_id\.lt\.\$\{ratchetHighestTo\.legoId\}`\)/)
  })
  // SECURITY FINDING INPUT-03: updateLegoProgress spreads the caller's raw
  // `updates` object into the write — the only `...spread` into a Supabase
  // write in api/**, unlike its sibling saveLegoProgress which allow-lists
  // columns. A caller can re-point a progress row at another learner_id.
  it('updateLegoProgress still spreads the untyped request body into the update payload', () => {
    const src = read('api/school/class-progress.ts')
    expect(src).toMatch(/\.update\(\{ \.\.\.updates, updated_at: new Date\(\)\.toISOString\(\) \}\)/)
  })
  it.todo('SECURE: coerce/validate roundIndex and legoId before interpolation; allow-list updateLegoProgress columns')
})

describe('INPUT-04: /api/player-events still attributes unauthenticated events via a client-set cookie', () => {
  // SECURITY FINDING INPUT-04: without a bearer, the handler trusts the
  // `ssi-user-id` cookie (uuid-shape checked only) and inserts with the
  // service-role key — an attacker can fabricate events against ANY learner's
  // uuid, poisoning the analytics CLAUDE.md names as the audio-play source of
  // truth.
  it('the no-bearer path still resolves learner_id from the ssi-user-id cookie', () => {
    const src = read('api/player-events.ts')
    expect(src).toMatch(/rawUserId = \(req\.cookies\?\.\['ssi-user-id'\]/)
    expect(src).toMatch(/return rawUserId && UUID_RE\.test\(rawUserId\) \? rawUserId : null/)
  })
  it.todo('SECURE: without a verified bearer, insert learner_id: null instead of trusting the cookie')
})

describe('INPUT-06 / COORD-01: admin/users.ts search param still injects into a service-role .or()', () => {
  // SECURITY FINDING INPUT-06 / COORD-01: `search` is interpolated unescaped
  // into an .or() filter expression evaluated with RLS bypassed (service-role
  // client). Admin-gated, so the ceiling is a lower-trust operator widening
  // their own read, or a %/`_` wildcard DoS lever.
  it('users.ts still builds orParts by raw template-literal interpolation of `search`', () => {
    const src = read('api/admin/users.ts')
    expect(src).toMatch(/const orParts = \[`display_name\.ilike\.%\$\{search\}%`\]/)
  })
  it.todo('SECURE: escape/reject `, ( ) .` in search before interpolation, or use a shared escapePostgrestFilterValue()')
})

describe('INPUT-07: /api/email/verify guards a non-string email — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25. `email.toLowerCase()` still sits outside the try block —
  // that placement is fine — but a shaped body ({email: {...}}) no longer
  // reaches it: both fields are type-checked first and a non-string gets the
  // honest 400 rather than a raw TypeError escaping as an opaque 500 with a
  // stack trace in the logs. `token` is checked too; it is relayed to GoTrue.
  it('SECURE: email and token are type-checked as strings, 400 otherwise', () => {
    const src = read('api/email/verify.ts')
    const normalizeIdx = src.indexOf('const normalizedEmail = email.toLowerCase().trim()')
    expect(normalizeIdx).toBeGreaterThan(-1)
    const guardIdx = src.indexOf("typeof email !== 'string'")
    expect(guardIdx).toBeGreaterThan(-1)
    // The guard runs BEFORE the normalisation, and refuses.
    expect(guardIdx).toBeLessThan(normalizeIdx)
    expect(src).toMatch(/typeof email !== 'string' \|\| typeof token !== 'string'/)
    expect(src.slice(guardIdx, normalizeIdx)).toMatch(/status\(400\)/)
  })
})

describe('INPUT-08: the audio proxy 502 body still leaks the S3 key and raw AWS error', () => {
  // SECURITY FINDING INPUT-08: an anonymous caller who triggers any S3
  // failure receives the internal object key and the AWS error text/code,
  // which routinely carries the bucket ARN and key-prefix layout.
  it('[audioId].ts 502 body still includes details and key fields', () => {
    const src = read('api/audio/[audioId].ts')
    expect(src).toMatch(/status\(502\)\.json\(\{[\s\S]{0,120}details: s3Error/)
    expect(src).toMatch(/key: sample\.s3_key/)
  })
  it.todo('SECURE: return a generic 502 body; keep key/details in console.error only')
})

describe('INPUT-09: unbounded / untyped string writes remain', () => {
  // SECURITY FINDING INPUT-09: course_code and client_version have no type
  // check and no length cap (contrast event_type, correctly .slice(0, 64));
  // class_name is type-checked but never capped anywhere it is written.
  it('player-events.ts still writes course_code/client_version with no type check or cap', () => {
    const src = read('api/player-events.ts')
    expect(src).toContain('course_code: e.course_code || null')
    expect(src).toContain('client_version: e.client_version || null')
  })
  it('class_name writers still have no length cap', () => {
    for (const file of ['api/school/rename-class.ts', 'api/teacher/classes.ts']) {
      const src = read(file)
      expect(src, file).not.toMatch(/class_name.*\.slice\(0,\s*\d+\)/)
    }
  })
  it.todo('SECURE: apply the typeof===\'string\' ? x.slice(0,N) : null pattern used by update-profile.ts/onboarding/profile.ts')
})

describe('INPUT-11: outbound DNS driven by an unauthenticated body — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25 with two in-process brakes ahead of dns.resolveMx: a
  // per-bucket window keyed on the caller's platform-attested IP hash (passed
  // in by possession-redeem, the same hash the code throttle uses), and a
  // short-lived per-domain answer cache that collapses the ordinary case — a
  // school onboarding fifty pupils on one domain — to a single lookup.
  //
  // Deliberately NOT the possession_mint_attempts ledger: a DB round-trip to
  // decide whether to make a DNS round-trip costs more than the thing it
  // protects. Honest limit, stated in the module: this state is per warm lambda
  // instance, so it bounds the cheap high-volume abuse, which is the abuse that
  // exists. Over-budget returns null — the module's existing "inconclusive" —
  // so the fail-open semantics the paired todo asked to keep are kept, and a
  // throttled legitimate signup proceeds rather than being blocked.
  it('SECURE: the MX lookup is rate-limited per caller and keeps its fail-open semantics', () => {
    const emailValidation = read('api/_utils/emailValidation.ts')
    expect(emailValidation).toContain('dns.resolveMx(domain)')
    // The gate sits BEFORE the lookup.
    const gateIdx = emailValidation.indexOf('if (mxBucketOverLimit(bucketKey))')
    const lookupIdx = emailValidation.indexOf('dns.resolveMx(domain)')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(lookupIdx)
    // Over budget is inconclusive (null), never "invalid" — fail open.
    expect(emailValidation).toMatch(/if \(mxBucketOverLimit\(bucketKey\)\) \{[\s\S]{0,200}return null/)
    // And the caller supplies its platform-attested bucket.
    const redeem = read('api/auth/possession-redeem.ts')
    expect(redeem).toContain('hasMxRecord(normalizedEmail, undefined, ipHash)')
  })
})

describe('INPUT-12: cron secret comparison is still non-constant-time; the non-prod skip persists', () => {
  // SECURITY FINDING INPUT-12: `authHeader !== \`Bearer ${cronSecret}\`` is a
  // plain string compare, not crypto.timingSafeEqual. Separately, when
  // CRON_SECRET is unset AND VERCEL_ENV/NODE_ENV is not exactly 'production'
  // (e.g. an unconfigured preview deployment), the auth check is skipped
  // entirely rather than failing closed. The production case IS now fixed
  // (refuses to run with a 500) — only the narrower preview/self-hosted gap
  // and the timing-safety nit remain.
  it('both cron handlers still compare the bearer with !==, not timingSafeEqual', () => {
    for (const file of ['api/cron/expire-demo-schools.ts', 'api/cron/teacher-payouts.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/authHeader !== `Bearer \$\{cronSecret\}`/)
      expect(src, file).not.toContain('timingSafeEqual')
    }
  })
  it('the auth check is still skipped outright when cronSecret is unset and the environment is not production', () => {
    for (const file of ['api/cron/expire-demo-schools.ts', 'api/cron/teacher-payouts.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/if \(cronSecret && authHeader !== `Bearer \$\{cronSecret\}`\)/)
    }
  })
  it.todo('SECURE: use crypto.timingSafeEqual; fail closed whenever VERCEL_ENV is set at all, not only when it equals production')
})
