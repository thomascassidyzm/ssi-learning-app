/**
 * JOB 3 (2026-08-25 audit, Area D) — integrity of the security-test machinery
 * itself. docs/security-audit-2026-08-25/area-d-db-and-hygiene.md has the
 * full write-up; this file is the guard, not the write-up.
 *
 * There are three conventions live under api/**:
 *   - api/**.test.ts            — `pnpm test:api`, a CI gate (verify.yml,
 *                                  auto-merge-claude.yml)
 *   - api/**.security.test.ts   — same glob as above (`.security.test.ts`
 *                                  still ends in `.test.ts`), so ALSO gated.
 *   - api/**.security-audit.ts  — `pnpm test:security-audit`, its own vitest
 *                                  config, deliberately RED by design, and
 *                                  NOT referenced anywhere in
 *                                  .github/workflows/*.yml.
 *
 * THE VERDICT: yes, there is a real path to losing a finding silently.
 *   1. `*.security-audit.ts` files are never run in CI at all — a deletion or
 *      a rename to a non-matching suffix produces NO red anywhere, because
 *      nothing in CI ever collected them to begin with. `test:security-audit`
 *      is a human-run command.
 *   2. Even for `*.security.test.ts` (which IS in the CI-gated glob), CI only
 *      checks that whatever IS collected passes — deleting the file entirely
 *      makes the suite trivially "more green", not red. There is no assertion
 *      anywhere that a specific roster of security-relevant files must exist.
 *   3. `tsconfig.api.json`'s `exclude` currently only knocks out `**\/*.test.ts`,
 *      so `*.security-audit.ts` files ARE typechecked today — but that is an
 *      absence of an exclusion, not a presence of protection; a future
 *      broadening of that exclude pattern (e.g. to `**\/*.security*.ts`) would
 *      silently drop them from typecheck too, and nothing here would notice
 *      unless this file's own assertions about the exclude pattern break.
 *
 * This file is the mitigation for (2) and (3): it PINS the known roster of
 * both file classes and the shape of the three config surfaces, so:
 *   - deleting or renaming a pinned file breaks this test (which — being
 *     itself `*.security.test.ts` — rides `pnpm test:api`, a real CI gate);
 *   - loosening `vitest.api.config.ts` / `vitest.security-audit.config.ts` /
 *     `tsconfig.api.json`'s exclude breaks this test;
 *   - removing `pnpm test:api` from either workflow breaks this test.
 *
 * It does NOT close gap (1) — that would require adding
 * `pnpm run test:security-audit` to CI, which is a production/process change
 * out of scope for this audit (and arguably wrong to do blindly: that suite
 * is deliberately red, so adding it verbatim would turn CI permanently red).
 * That gap is reported, not fixed, in the area-d report.
 *
 * Pure source-text assertions — no DB, no network, no child process.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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
    'api/_utils/actAsGuard.advisory.security.test.ts',
    'api/_utils/adminPracticeMinutesAnonExposure.security.test.ts',
    'api/_utils/definerSearchPath.security.test.ts',
    'api/_utils/joinCodeEntropy.security.test.ts',
    'api/_utils/securityTestMachineryIntegrity.security.test.ts',
    'api/admin/vadProsody.security.test.ts',
    'api/audio/batchUrlsBulk.security.test.ts',
    'api/billing/bindingLadder.security.test.ts',
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

  it('SECURITY FINDING (gap, not fixed here): pnpm test:api runs in CI; pnpm test:security-audit does not', () => {
    const verify = readFileSync(resolve(repoRoot, '.github/workflows/verify.yml'), 'utf8')
    const autoMerge = readFileSync(resolve(repoRoot, '.github/workflows/auto-merge-claude.yml'), 'utf8')

    expect(verify).toContain('pnpm test:api')
    expect(autoMerge).toContain('pnpm test:api')

    // The gap: nothing runs the security-audit suite as a gate. Deleting or
    // renaming a *.security-audit.ts file today produces zero CI signal —
    // this assertion documents that fact rather than silently relying on it.
    expect(verify).not.toContain('test:security-audit')
    expect(autoMerge).not.toContain('test:security-audit')
  })

  it.todo(
    'CLOSE THE GAP (needs a product decision, not made here): either promote every green ' +
      'security-audit finding into *.security.test.ts on fix (existing convention, already ' +
      'followed for SEC22-01), or add a CI step that runs test:security-audit and asserts its ' +
      'own file COUNT only (not exit code) so the suite can stay red without gating merges yet ' +
      'still catch a silent deletion',
  )
})
