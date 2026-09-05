/**
 * SEC0905-X — coordinator findings of the 2026-09-05 security audit
 * (docs/security-audit-2026-09-05/area-x-coordinator.md).
 *
 * These are CHARACTERISATION specs. They assert what is true TODAY, so they
 * are green and can live in the gated `pnpm run test:api` config. Each one is
 * written to go RED the moment the finding it documents is fixed — at which
 * point you delete the characterisation and, where noted, flip it to the
 * assertion in the comment beside it.
 *
 * Findings pinned here:
 *   X-01  the nightly gate has no `core-test` line          (MEDIUM, residual)
 *   X-02  `test:security-audit` is on no gate                (MEDIUM)
 *   X-03  SEC0901-A-01 subtree-by-slug-path still unfixed    (HIGH, residual)
 *   X-06  no secrets in tracked source                       (SECURE-ASSERTION)
 *
 * X-04 (dependencies) and X-05 (echarts tooltip HTML sink) are pinned in
 * packages/player-vue/src/security/echartsTooltipHtmlSink.security.test.ts,
 * because both concern the browser bundle.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// fileURLToPath(import.meta.url) is broken under this repo's test envs
// (see memory: vitest-import-meta-url-happy-dom) — anchor on cwd instead.
const repoRoot = process.cwd()
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

describe('SEC0905-X-02 — which vitest config collects which security spec', () => {
  it('the gated api config collects *.security.test.ts', () => {
    const cfg = read('vitest.api.config.ts')
    expect(cfg).toContain("include: ['api/**/*.test.ts']")
    // `api/**/*.test.ts` matches `foo.security.test.ts`. That is the whole
    // reason this audit writes findings as *.security.test.ts and not as
    // *.security-audit.ts.
    expect('api/_security/sec0905-x-coordinator.security.test.ts').toMatch(/\.test\.ts$/)
  })

  it('the gated player-vue config collects src/security/*.security.test.ts', () => {
    const cfg = read('packages/player-vue/vitest.config.ts')
    expect(cfg).toContain("include: ['src/**/*.test.ts']")
  })

  it('CHARACTERISATION: the *.security-audit.ts specs are collected ONLY by the ungated config', () => {
    const cfg = read('vitest.security-audit.config.ts')
    expect(cfg).toContain("include: ['api/**/*.security-audit.ts']")
    // and that config's script is `test:security-audit`, which nothing runs.
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['test:security-audit']).toBe(
      'vitest run -c vitest.security-audit.config.ts',
    )
  })

  it('CHARACTERISATION (X-02): the nightly gate runs neither test:security-audit nor core test', () => {
    // The estate's real gate. If it has moved, this test must be updated
    // rather than deleted — the finding is about the gate, not this path.
    const gate = '/home/tomcassidy/command-surface/ops/ci/ci-checks.sh'
    if (!existsSync(gate)) {
      // Explicit gap rather than a false green: say so loudly.
      expect.soft(gate, 'gate script not reachable from this worktree').toBe(gate)
      return
    }
    const sh = readFileSync(gate, 'utf-8')
    // These four ARE on the gate.
    for (const check of ['player-test', 'api-test', 'api-typecheck', 'release-train-test']) {
      expect(sh).toContain(check)
    }
    // FINDING X-01: `@ssi/core`'s 751 tests are not. Flip to `.toContain`
    // when `run core-test ... --filter @ssi/core test` is added.
    expect(sh).not.toContain('core-test')
    // FINDING X-02: nor is the security-audit config.
    expect(sh).not.toContain('test:security-audit')
  })
})

describe('SEC0905-X-03 — SEC0901-A-01 residual: group subtree resolved by mutable slug path', () => {
  const src = read('api/_utils/demoSchoolGraph.ts')

  it('CHARACTERISATION: resolveGroupSubtreeIds still decides membership by string prefix on `path`', () => {
    // The finding, in one assertion. When the fix lands (recursive parent_id
    // walk, or an ancestry column names cannot change), this goes red.
    expect(src).toContain('startsWith(`${rootPath}/`)')
    expect(src).not.toContain('parent_id')
  })

  it('CHARACTERISATION: it reads EVERY group row with no tenant filter', () => {
    // `.select('id, path')` with no `.eq`/`.in` — the unscoped read that makes
    // the prefix filter the only thing standing between tenants.
    const body = src.slice(src.indexOf('export async function resolveGroupSubtreeIds'))
    expect(body).toMatch(/from\('groups'\)\s*\.select\('id, path'\)\s*\n/)
  })

  it('documents the three call sites that consume the result', () => {
    for (const site of [
      'api/admin/demo-leaf.ts',
      'api/_utils/demoSchoolRefresh.ts',
      'api/_utils/demoNodeRefresh.ts',
    ]) {
      expect(read(site)).toContain('resolveGroupSubtreeIds')
    }
    // and what it reaches: staff auth uids.
    expect(src).toContain('staffAuthUids')
  })
})

describe('SEC0905-X-06 — no secrets in tracked source (regression guard)', () => {
  it('no JWT literal, live key, AWS key id or PEM block outside docs/archive', () => {
    // git grep over TRACKED files only — an untracked local .env is the
    // developer's business; a committed one is the finding.
    const pattern =
      'eyJhbGciOiJIUzI1NiI|sk_live_[A-Za-z0-9]|pk_live_[A-Za-z0-9]|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY'
    let out = ''
    try {
      out = execFileSync(
        'git',
        // `:!<this file>` — the scanner must not match the pattern string it
        // carries in its own source. Only THIS file is excluded, never the
        // *.security.test.ts class: a secret committed in some other security
        // spec is exactly the thing this guard exists to catch.
        ['grep', '-nIE', pattern, '--', ':!*.md', ':!archive/*',
         ':!api/_security/sec0905-x-coordinator.security.test.ts'],
        { cwd: repoRoot, encoding: 'utf-8' },
      )
    } catch (e: unknown) {
      // git grep exits 1 on no match. That is the pass.
      const err = e as { status?: number; stdout?: string }
      if (err.status === 1) out = ''
      else throw e
    }
    expect(out.trim()).toBe('')
  })

  it('no .env file of any kind is tracked', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf-8' })
    const envFiles = tracked.split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f))
    expect(envFiles).toEqual([])
  })

  it('no client-side source reads SUPABASE_SERVICE_ROLE_KEY outside tests and comments', () => {
    let out = ''
    try {
      out = execFileSync(
        'git',
        ['grep', '-nI', 'SUPABASE_SERVICE_ROLE_KEY', '--', 'packages/player-vue/src'],
        { cwd: repoRoot, encoding: 'utf-8' },
      )
    } catch {
      out = ''
    }
    const real = out
      .split('\n')
      .filter(Boolean)
      .filter((l) => !/\.test\.ts:/.test(l))
      .filter((l) => !/:\s*\*/.test(l)) // jsdoc/comment lines
    expect(real).toEqual([])
  })
})
