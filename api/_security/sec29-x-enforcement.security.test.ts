/**
 * SEC29-X — the coordinator's area for the 2026-08-29 audit: whether this
 * repo's security machinery is ENFORCED, and whether its record of the
 * database is still true.
 *
 * Five audits (2026-08-11, 08-18, 08-22, 08-25, and this one) have written
 * their findings as tests, on an explicit convention:
 *
 *   > a characterization test asserts today's insecure behaviour and passes
 *   > today; when someone fixes the finding it goes RED on purpose — that is
 *   > the signal the finding is closed.
 *
 * That convention has exactly one load-bearing assumption: something runs the
 * tests. This file audits that assumption, plus the sibling assumption that
 * `supabase/schema.sql` describes the database the findings are about.
 *
 * Hermetic: reads only files in this repo. No network, no database, no `gh`.
 * The live-CI evidence behind SEC29-X-01 is recorded in
 * `docs/security-audit-2026-08-29/README.md` §1 — it cannot be asserted from
 * a test without network, and is reported there rather than faked here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('SEC29-X-01 — the security-audit suite is not on any CI gate', () => {
  // The 2026-08-18 audit deliberately parked five failing specs in their own
  // config so a permanently-red suite could not block the merge gate. That was
  // the right call for the gate. The cost is that NOTHING runs them, so a
  // finding can be fixed — or regress — with no signal either way.
  const workflows = ['.github/workflows/verify.yml', '.github/workflows/auto-merge-claude.yml']

  it('both CI workflows run test:api', () => {
    for (const w of workflows) expect(read(w)).toContain('pnpm test:api')
  })

  // SECURITY FINDING SEC29-X-01: no workflow runs `pnpm test:security-audit`,
  // so the five specs below are never executed by anything automatic. Verified
  // by hand on 2026-08-29: all five still FAIL, i.e. findings 3, 4 and 5 of the
  // 2026-08-18 audit are all still live, eleven days on.
  it('no CI workflow runs the security-audit suite (characterization)', () => {
    for (const w of workflows) expect(read(w)).not.toContain('test:security-audit')
  })

  it.todo('a CI workflow runs pnpm test:security-audit (or its specs are promoted into api/**/*.test.ts once green)')

  it('the security-audit specs exist, and the CI-gated config cannot collect them', () => {
    const gated = read('vitest.api.config.ts')
    const ungated = read('vitest.security-audit.config.ts')
    expect(gated).toContain("include: ['api/**/*.test.ts']")
    expect(ungated).toContain("include: ['api/**/*.security-audit.ts']")

    // The two specs holding 2026-08-18 findings 3/4/5. If either is deleted or
    // renamed, this goes red — which is the point: a finding must not be able
    // to disappear quietly.
    expect(existsSync(join(ROOT, 'api/code/validate.ipSpoof.security-audit.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'api/school/class-progress.untrustedArgs.security-audit.ts'))).toBe(true)

    // `.security-audit.ts` does not end in `.test.ts`, so the gated glob misses it.
    expect('api/code/validate.ipSpoof.security-audit.ts'.endsWith('.test.ts')).toBe(false)
  })
})

describe('SEC29-X-02 — the committed schema dump has diverged from production', () => {
  // The 2026-08-25 remediation pass applied `20260825_sec25_d02_practice_minutes_gate.sql`
  // to the LIVE database under the canary runbook (12 assertions, 12 green,
  // COMMITTED — transcript in that branch's remediation-notes.md). The migration
  // file, the updated dump and the canary script are all stranded on the
  // unmerged branch `security/remediation-2026-08-25`.
  //
  // So on `dev` today the dump still records a grant that production no longer
  // has. Every audit's DB-posture findings are read off this dump — 2026-08-25
  // said so in its own gaps section — which makes a silent divergence a
  // correctness problem for the whole audit method, not a tidiness one.

  it('the SEC25-D-02 migration is absent from this branch (characterization)', () => {
    // SECURITY FINDING SEC29-X-02
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    expect(migrations).not.toContain('20260825_sec25_d02_practice_minutes_gate.sql')
  })

  it('the dump still shows admin_practice_minutes granted to anon (characterization)', () => {
    // SECURITY FINDING SEC29-X-02: production has REVOKEd this; the dump has not
    // been refreshed. The grant line below is the stale record, not the live state.
    const schema = read('supabase/schema.sql')
    expect(schema).toContain('GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO anon;')
  })

  it.todo('the remediation branch is merged: the migration is present and the dump shows REVOKE ALL … FROM PUBLIC')
})

describe('SEC29-X-03 — TENANCY-01 is still live on dev (day 18)', () => {
  // Filed critical on 2026-08-11, re-verified by the 2026-08-25 coordinator,
  // re-verified here line-by-line on 2026-08-29. The subtree for a group's
  // invite codes is resolved by PATH STRING, and two unrelated root orgs whose
  // names slug identically get EQUAL paths — a collision any signed-in user can
  // manufacture, because root-org creation is open self-service and the
  // duplicate-name check is, in its own comment, "a WARNING (never a constraint)".
  //
  // The fix has been known and unapplied for 18 days: resolve by parent_id via
  // `descendantIds()`, which is what the c2f04665 hardening pass already did for
  // groupSubtree, schoolScope, groupRollups and rate-compare. invites.ts is the
  // caller that pass missed.
  it('resolves the invite subtree by path string, not by parent_id (characterization)', () => {
    // SECURITY FINDING TENANCY-01 (2026-08-11, critical — still live)
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toContain('path.eq.${path},path.like.${path}/%')
    expect(src).not.toContain('descendantIds')
  })

  it('rate-compare, the sibling the hardening pass DID reach, uses descendantIds', () => {
    // The control that holds — and the proof the fix is a known, applied pattern
    // in this codebase rather than a design question.
    expect(read('api/groups/[id]/rate-compare.ts')).toContain("import { descendantIds } from '../../_utils/groupSubtree'")
  })

  it.todo('api/groups/[id]/invites.ts resolves its subtree with descendantIds()')
})

describe('SEC29-X-04 — the silent anon-key fallback is wider than filed', () => {
  // SEC25-X-02 (2026-08-25, low) named two sites: courses/[code]/round-map.ts
  // and _utils/audioAccess.ts. The pattern `supabaseServiceKey || <anon key>`
  // means a missing or mistyped SUPABASE_SERVICE_ROLE_KEY does not fail the
  // request — it silently swaps the identity the query runs as, moving read
  // authority from "the handler decided" to "whatever RLS happens to be".
  //
  // The census is actually FOUR content endpoints plus the audio client: all of
  // courses/[code]/{round-map,cycles,bundle,infplay-cycles} — that is, every
  // endpoint that serves the paid course product — and _utils/audioAccess.ts,
  // the client behind both audio/[audioId].ts and audio/batch-urls.ts.
  const FALLBACK_SITES = [
    'api/courses/[code]/round-map.ts',
    'api/courses/[code]/cycles.ts',
    'api/courses/[code]/bundle.ts',
    'api/courses/[code]/infplay-cycles.ts',
    'api/_utils/audioAccess.ts',
  ]

  it('all five sites still degrade to the anon key rather than failing closed (characterization)', () => {
    // SECURITY FINDING SEC29-X-04 (widens SEC25-X-02)
    for (const f of FALLBACK_SITES) {
      const src = read(f).replace(/\s+/g, ' ')
      expect(src, f).toMatch(/supabaseServiceKey \|\|/)
    }
  })

  it('the fail-closed convention it diverges from has a quorum', () => {
    // Handlers that DO fail closed on a missing service key, so "fail closed"
    // is this codebase's own majority convention, not an auditor's preference.
    for (const f of ['api/groups/tree.ts', 'api/access/claim.ts']) {
      expect(read(f), f).toMatch(/Server misconfigured|Missing service role key/)
    }
  })

  it.todo('every service-role handler returns 500 Server misconfigured when SUPABASE_SERVICE_ROLE_KEY is absent')
})
