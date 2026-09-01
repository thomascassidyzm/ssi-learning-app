/**
 * SEC0901-X — coordinator: is the security machinery still enforced, and are the
 * previous audits' open items still open?
 *
 * The 2026-08-29 audit's headline (SEC29-X-01) was not a vulnerability in a
 * handler. It was that NOTHING RUNS THE TESTS: six audits had written their
 * findings as tests on the convention "a characterization goes red when the
 * finding is fixed", and that convention rests entirely on something executing
 * them. GitHub Actions has not started a job on this repository since
 * 2026-08-14 (billing), so it does not.
 *
 * These tests are the part of that finding that CAN live in the repo: they pin
 * the repo-side facts — which globs are gated, which schema grants exist —
 * so that a change to any of them is visible to whoever next runs the suite by
 * hand. They deliberately assert nothing about GitHub, which is not knowable
 * offline.
 *
 * Read the labels: [SECURE-ASSERTION] pins a control that holds today and goes
 * red if it regresses. [CHARACTERIZATION] pins insecure or unfinished behaviour
 * that is true today and goes RED ON PURPOSE when someone fixes it — red there
 * means the finding is CLOSED, not that anything broke.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

describe('SEC0901-X-01 [CHARACTERIZATION] — the .security-audit.ts glob is still off the merge gate', () => {
  // `vitest.api.config.ts` collects `api/**/*.test.ts`. Files named
  // `*.security-audit.ts` match that glob NOT AT ALL, and the one config that
  // does collect them — vitest.security-audit.config.ts — is referenced by no
  // workflow. So these specs are run by nothing in CI and nothing on the gate.
  //
  // This goes red when someone renames those files to `*.security.test.ts` (or
  // adds the security-audit config to verify.yml). Red = FINDING CLOSED.
  const orphans = walk('api').filter((f) => f.endsWith('.security-audit.ts'))

  it('finds the orphaned spec files that no gated config collects', () => {
    expect(orphans.sort()).toEqual([
      'api/code/validate.ipSpoof.security-audit.ts',
      'api/school/class-progress.untrustedArgs.security-audit.ts',
    ])
  })

  it('the gated api config cannot collect them', () => {
    const cfg = read('vitest.api.config.ts')
    expect(cfg).toContain("include: ['api/**/*.test.ts']")
    // The decisive point: none of the orphans ends in `.test.ts`.
    for (const f of orphans) expect(f.endsWith('.test.ts')).toBe(false)
  })

  it('and the only config that does collect them is on no workflow', () => {
    const verify = read('.github/workflows/verify.yml')
    expect(verify).toContain('pnpm test:api')
    expect(verify).not.toContain('test:security-audit')
  })
})

describe('SEC0901-X-02 [SECURE-ASSERTION] — SEC29-X-02 is closed: the schema dump records the practice-minutes revoke', () => {
  // The 2026-08-29 audit found the committed dump still recording
  // `GRANT ALL ON FUNCTION admin_practice_minutes(...) TO anon` for a grant
  // production no longer had, because the remediation was stranded on an
  // unmerged branch. It has since merged. This pins the dump to the live
  // posture so a future regenerated dump that reintroduces the grant is caught.
  const schema = read('supabase/schema.sql')

  it('admin_practice_minutes is service_role only — no anon, no authenticated', () => {
    const acl = schema
      .split('\n')
      .filter((l) => /ON FUNCTION public\.admin_practice_minutes\(p_learner_ids uuid\[\]\)/.test(l))
    expect(acl.some((l) => /REVOKE ALL .* FROM PUBLIC/.test(l))).toBe(true)
    expect(acl.some((l) => /GRANT ALL .* TO service_role/.test(l))).toBe(true)
    expect(acl.some((l) => /GRANT .* TO anon/.test(l))).toBe(false)
    expect(acl.some((l) => /GRANT .* TO authenticated/.test(l))).toBe(false)
  })

  it('admin_practice_minutes_by_course is revoked from anon', () => {
    const acl = schema
      .split('\n')
      .filter((l) => /ON FUNCTION public\.admin_practice_minutes_by_course\(p_learner_ids uuid\[\]\)/.test(l))
    expect(acl.some((l) => /GRANT .* TO anon/.test(l))).toBe(false)
  })

  it('its no-argument (platform-wide) path carries an in-body admin gate', () => {
    const body = schema.slice(schema.indexOf('CREATE FUNCTION public.admin_practice_minutes_by_course'))
    const decl = body.slice(0, body.indexOf('$$;'))
    expect(decl).toContain('p_learner_ids IS NULL')
    expect(decl).toContain('public.is_ssi_admin()')
    expect(decl).toMatch(/RAISE EXCEPTION 'Forbidden/)
  })
})

describe('SEC0901-X-03 [CHARACTERIZATION] — the SEC25-D-02 residual is still open', () => {
  // Recorded deliberately by the 2026-08-25 remediation rather than papered
  // over: closing the NULL path left the SCOPED path open. Any signed-in user
  // may still call `admin_practice_minutes_by_course(<uuid[]>)` with learner
  // UUIDs they have merely seen — a SECURITY DEFINER read that bypasses RLS —
  // and get those learners' per-course practice minutes back. It is `authenticated`
  // rather than `anon` and it needs a known UUID, which is why it was accepted;
  // it is not closed, and the migration says the fix is repointing the four
  // browser callers at a server endpoint on the resolveVisibleScope pattern.
  //
  // Goes red when EXECUTE is revoked from `authenticated` or an in-body scope
  // check is added to the non-NULL path. Red = FINDING CLOSED.
  const schema = read('supabase/schema.sql')

  it('EXECUTE is still held by authenticated', () => {
    const acl = schema
      .split('\n')
      .filter((l) => /ON FUNCTION public\.admin_practice_minutes_by_course\(p_learner_ids uuid\[\]\)/.test(l))
    expect(acl.some((l) => /GRANT .* TO authenticated/.test(l))).toBe(true)
  })

  it('and the body gates only the NULL argument, never the supplied ids', () => {
    const body = schema.slice(schema.indexOf('CREATE FUNCTION public.admin_practice_minutes_by_course'))
    const decl = body.slice(0, body.indexOf('$$;'))
    // The one guard is conditioned on p_learner_ids IS NULL...
    expect(decl).toMatch(/IF\s+p_learner_ids IS NULL/)
    // ...and nothing checks that the caller may see the ids they did supply.
    expect(decl).not.toMatch(/current_learner_id\(\)/)
    expect(decl).not.toMatch(/= any\(p_learner_ids\)[\s\S]*is_ssi_admin/)
  })

  it('the residual is documented where a reader will find it', () => {
    const mig = read('supabase/migrations/20260825_sec25_d02_practice_minutes_gate.sql')
    expect(mig).toContain('RESIDUAL')
    expect(mig).toContain('learner UUID they already know')
  })
})

describe('SEC0901-X-04 [SECURE-ASSERTION] — the 2026-08-18 findings 3/4/5 are closed', () => {
  // The 2026-08-29 audit reported all five specs in
  // `vitest.security-audit.config.ts` still FAILING, i.e. those three findings
  // still live eleven days on. Re-run on 2026-09-01 they all pass: the
  // remediation landed. This pins the two utilities that closed them, since the
  // specs themselves are still off the gate (SEC0901-X-01) and so cannot be
  // relied on to notice a regression.
  it('a PostgREST filter sanitiser exists and is exported', () => {
    const f = read('api/_utils/postgrestFilter.ts')
    expect(f).toMatch(/export function \w+/)
  })

  it('the code-attempt throttle no longer takes its bucket from a client header', () => {
    const f = read('api/_utils/codeAttemptThrottle.ts')
    // A client-chosen X-Forwarded-For / x-real-ip must not be able to pick the
    // bucket. If either is read here at all, it must not be the sole key.
    const readsClientHeader = /x-forwarded-for|x-real-ip/i.test(f)
    if (readsClientHeader) {
      expect(f).toMatch(/x-vercel-forwarded-for|x-vercel-|platform|attest/i)
    } else {
      expect(readsClientHeader).toBe(false)
    }
  })
})
