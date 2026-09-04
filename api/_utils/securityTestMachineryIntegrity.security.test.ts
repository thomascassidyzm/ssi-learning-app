/**
 * JOB 3 (2026-08-25 audit, Area D) — integrity of the security-test machinery
 * itself. docs/security-audit-2026-08-25/area-d-db-and-hygiene.md has the
 * full write-up; this file is the guard, not the write-up.
 *
 * There are three conventions live under api/**:
 *   - api/**.test.ts            — `pnpm test:api`, a CI gate.
 *   - api/**.security.test.ts   — same glob as above (`.security.test.ts`
 *                                  still ends in `.test.ts`), so ALSO gated.
 *   - api/**.security-audit.ts  — `pnpm test:security-audit`, its own vitest
 *                                  config, deliberately RED by design, and
 *                                  run by NOTHING automatic.
 *
 * WHERE THE GATE LIVES (updated 2026-09-04). This file used to read
 * `.github/workflows/verify.yml` and `auto-merge-claude.yml` to prove
 * `pnpm test:api` ran as a gate. Those workflows are gone — deleted on
 * 2026-09-03 (8c2a8830) — because Tom ruled on 2026-08-31 that GitHub Actions
 * stays disabled across the estate: Actions had run on nothing since
 * 2026-08-14 (a billing problem), so CI moved to a nightly on watson-1.
 * The gate today is `command-surface/ops/ci/ci-checks.sh`, the single check
 * list shared by the 03:00 nightly (`ops/ci-run.sh`, which runs dev, staging
 * and main) and the merge-time command an agent runs before landing
 * (`ops/ci-check`). Its learning-app leg runs `pnpm test:api`; it does not run
 * `pnpm test:security-audit`.
 *
 * That script is NOT in this repo, and per the convention set by
 * `api/_security/sec0901-x-audit-machinery.security.test.ts` these tests pin
 * repo-side facts only — a test here must not assert against a path in
 * somebody's home directory, which would be green on watson-1 and red in every
 * fresh clone. So the gate fact is stated above in prose, and what is ASSERTED
 * below is the repo-side half: the two vitest configs, the two package.json
 * scripts, the typecheck exclude, and — conditionally — that any GitHub
 * workflow which ever comes BACK still carries `pnpm test:api`.
 *
 * THE VERDICT (unchanged): yes, there is a real path to losing a finding
 * silently.
 *   1. `*.security-audit.ts` files are never run by any gate at all — a
 *      deletion or a rename to a non-matching suffix produces NO red anywhere,
 *      because nothing automatic ever collected them. `test:security-audit` is
 *      a human-run command.
 *   2. Even for `*.security.test.ts` (which IS in the gated glob), the gate
 *      only checks that whatever IS collected passes — deleting the file
 *      entirely makes the suite trivially "more green", not red. There is no
 *      assertion anywhere that a specific roster of security-relevant files
 *      must exist.
 *   3. `tsconfig.api.json`'s `exclude` currently only knocks out `**\/*.test.ts`,
 *      so `*.security-audit.ts` files ARE typechecked today — but that is an
 *      absence of an exclusion, not a presence of protection; a future
 *      broadening of that exclude pattern (e.g. to `**\/*.security*.ts`) would
 *      silently drop them from typecheck too, and nothing here would notice
 *      unless this file's own assertions about the exclude pattern break.
 *
 * This file is the mitigation for (2) and (3): it PINS the known roster of
 * both file classes and the shape of the config surfaces, so:
 *   - deleting or renaming a pinned file breaks this test (which — being
 *     itself `*.security.test.ts` — rides `pnpm test:api`, which the watson-1
 *     gate runs on dev, staging and main every night);
 *   - loosening `vitest.api.config.ts` / `vitest.security-audit.config.ts` /
 *     `tsconfig.api.json`'s exclude breaks this test.
 *
 * It does NOT close gap (1) — that would require adding
 * `pnpm run test:security-audit` to the watson-1 check list, which is a
 * process change out of scope here (and arguably wrong to do blindly: that
 * suite is deliberately red, so adding it verbatim would turn the nightly
 * permanently red). That gap is reported, not fixed.
 *
 * Pure source-text assertions — no DB, no network, no child process.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const apiDir = resolve(repoRoot, 'api')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const allApiFiles = walk(apiDir)
const rel = (p: string) => p.slice(repoRoot.length + 1).replace(/\\/g, '/')

const securityAuditFiles = allApiFiles.filter((f) => f.endsWith('.security-audit.ts')).map(rel).sort()
const securityTestFiles = allApiFiles.filter((f) => f.endsWith('.security.test.ts')).map(rel).sort()

// ROSTER MAINTENANCE (coordinator, 2026-08-25). This roster is deliberately
// hand-maintained: adding a security test is a two-line change here, and
// DELETING one is what this file exists to make loud. It was updated once
// already, at the moment the four 2026-08-25 audit areas were merged together
// — the guard went red on the merge and named all seven added files, which is
// exactly the behaviour it was written for. Do not replace it with a glob.
describe('security-test machinery integrity — pinned roster', () => {
  // Pinned as of 2026-08-25. A file dropping off either list — deleted,
  // renamed to a non-matching suffix, or moved out of api/ — fails here.
  // Growing the list is fine (update the pin); shrinking it without a
  // corresponding entry in the area-d/area-audit report is the bug this test
  // exists to catch.
  const KNOWN_SECURITY_AUDIT_FILES = [
    'api/code/validate.ipSpoof.security-audit.ts',
    'api/school/class-progress.untrustedArgs.security-audit.ts',
  ].sort()

  const KNOWN_SECURITY_TEST_FILES = [
    'api/_security/reconcile-2026-08-25-admin-entitlement.security.test.ts',
    'api/_security/reconcile-2026-08-25-auth-core.security.test.ts',
    'api/_security/reconcile-2026-08-25-input.security.test.ts',
    'api/_security/reconcile-2026-08-25-tenancy.security.test.ts',
    'api/_security/sec0901-a-remediation-verification.security.test.ts',
    'api/_security/sec0901-b-onboarding.security.test.ts',
    'api/_security/sec0901-x-audit-machinery.security.test.ts',
    'api/_utils/actAsGuard.advisory.security.test.ts',
    'api/_utils/adminPracticeMinutesAnonExposure.security.test.ts',
    'api/_utils/codeAttemptThrottle.security.test.ts',
    'api/_utils/definerSearchPath.security.test.ts',
    'api/_utils/glossSegments.security.test.ts',
    'api/_utils/joinCodeEntropy.security.test.ts',
    'api/_utils/schoolSeats.security.test.ts',
    'api/_utils/securityTestMachineryIntegrity.security.test.ts',
    'api/admin/testDoors.security.test.ts',
    'api/admin/vadProsody.security.test.ts',
    'api/audio/batchUrlsBulk.security.test.ts',
    'api/audio/batchUrlsEntitlementVsAuth.security.test.ts',
    'api/billing/bindingLadder.security.test.ts',
    'api/code/redeemPrivilegeReach.security.test.ts',
    'api/courses/edgeCacheKeying.security.test.ts',
    'api/courses/roundMap.security.test.ts',
    'api/groups/groupsErrorLeakage.security.test.ts',
    'api/me/standing.security.test.ts',
    'api/playerEventsAttribution.security.test.ts',
    'api/teacher/admin-entitlement.paddle-webhook.security.test.ts',
    'api/teacher/paddle-billing-intent-addressing.security.test.ts',
    'api/teacher/paddle-payer-email-addressing.security.test.ts',
    'api/teacher/paddle-webhook-tenant-addressing.security.test.ts',
  ].sort()

  it('every *.security-audit.ts file on disk matches the pinned roster exactly', () => {
    expect(securityAuditFiles).toEqual(KNOWN_SECURITY_AUDIT_FILES)
  })

  it('every *.security.test.ts file on disk matches the pinned roster exactly', () => {
    expect(securityTestFiles).toEqual(KNOWN_SECURITY_TEST_FILES)
  })

  it('no api/** file uses a near-miss suffix that neither vitest config would collect', () => {
    // Typos/renames that would silently exit both globs: `.security-audits.ts`,
    // `.securityaudit.ts`, `.security_audit.ts`, `.security.tests.ts`, `.spec.ts`
    // living anywhere under api/ with "security" in the name.
    const suspects = allApiFiles
      .map(rel)
      .filter((f) => /security/i.test(f))
      .filter((f) => !f.endsWith('.security-audit.ts') && !f.endsWith('.security.test.ts') && !f.endsWith('.test.ts'))
    expect(suspects).toEqual([])
  })
})

describe('security-test machinery integrity — config wiring', () => {
  it('vitest.api.config.ts collects api/**/*.test.ts (so *.security.test.ts rides it)', () => {
    const cfg = readFileSync(resolve(repoRoot, 'vitest.api.config.ts'), 'utf8')
    expect(cfg).toMatch(/include:\s*\[\s*['"]api\/\*\*\/\*\.test\.ts['"]\s*\]/)
  })

  it('vitest.security-audit.config.ts collects ONLY api/**/*.security-audit.ts (disjoint from test:api)', () => {
    const cfg = readFileSync(resolve(repoRoot, 'vitest.security-audit.config.ts'), 'utf8')
    expect(cfg).toMatch(/include:\s*\[\s*['"]api\/\*\*\/\*\.security-audit\.ts['"]\s*\]/)
  })

  it('package.json wires test:api and test:security-audit to those two configs', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:api']).toBe('vitest run -c vitest.api.config.ts')
    expect(pkg.scripts['test:security-audit']).toBe('vitest run -c vitest.security-audit.config.ts')
  })

  it('tsconfig.api.json includes all of api/**/*.ts and excludes only *.test.ts — *.security-audit.ts is typechecked', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(repoRoot, 'tsconfig.api.json'), 'utf8'))
    expect(tsconfig.include).toContain('api/**/*.ts')
    expect(tsconfig.exclude).toContain('**/*.test.ts')
    // The absence-of-exclusion this test protects: broadening this pattern
    // (e.g. to something matching "security-audit") would silently drop
    // those files from `pnpm typecheck:api` without any other signal.
    expect(tsconfig.exclude.some((p: string) => /security/i.test(p))).toBe(false)
  })

  it('the gate is not GitHub Actions any more — and if a workflow ever returns, it must run pnpm test:api', () => {
    // Tom's ruling 2026-08-31: Actions stays disabled across the estate; CI is
    // the watson-1 nightly (command-surface/ops/ci/ci-checks.sh). The two
    // workflow files this test used to read were deleted on 2026-09-03
    // (8c2a8830) — their absence is the DESIGN, not a defect, so it is not an
    // assertion failure here.
    //
    // What is still worth pinning is the conditional: the day somebody
    // reinstates a workflow that runs this repo's suites, `pnpm test:api` has
    // to be in it, or the security tests silently stop being gated by the very
    // thing that replaced the nightly. Vacuously true today; loud the moment
    // Actions comes back half-wired.
    const wfDir = resolve(repoRoot, '.github/workflows')
    const workflows = existsSync(wfDir)
      ? readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      : []

    for (const wf of workflows) {
      const body = readFileSync(join(wfDir, wf), 'utf8')
      // Only workflows that run this repo's test suites are in scope — a
      // docs/label/notification workflow is none of this test's business.
      const runsSuites = /pnpm (--filter [\w@/-]+ )?test\b|vitest|test:api/.test(body)
      if (!runsSuites) continue
      expect(body, `${wf} runs suites but not the api gate`).toContain('pnpm test:api')
    }
  })

  it('the security-audit suite is still gated by nothing (gap, reported not fixed)', () => {
    // The other half of the old assertion, restated repo-side. `test:api` and
    // `test:security-audit` are two disjoint scripts over two disjoint globs
    // (pinned above); the watson-1 check list runs the first and not the
    // second, so deleting a *.security-audit.ts file produces zero signal.
    // What CAN be asserted here is that nothing in the repo has quietly
    // merged the two — folding the security-audit glob into test:api would
    // turn every gate permanently red, because that suite is red by design.
    const apiCfg = readFileSync(resolve(repoRoot, 'vitest.api.config.ts'), 'utf8')
    expect(apiCfg).not.toContain('security-audit')

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:api']).not.toContain('security-audit.config')
  })

  it.todo(
    'CLOSE THE GAP (needs a product decision, not made here): either promote every green ' +
      'security-audit finding into *.security.test.ts on fix (existing convention, already ' +
      'followed for SEC22-01), or add a leg to the watson-1 check list (ops/ci/ci-checks.sh) that runs test:security-audit and asserts its ' +
      'own file COUNT only (not exit code) so the suite can stay red without gating merges yet ' +
      'still catch a silent deletion',
  )
})
