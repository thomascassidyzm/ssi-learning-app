/**
 * SEC0901-X — coordinator: is the security machinery enforced, and are the
 * previous audits' open items still open?
 *
 * Six audits wrote their findings as tests on the convention "a characterization
 * goes red when the finding is fixed". That convention rests on something
 * running them, and something does: Tom's ruling of 2026-08-29 moved CI off
 * GitHub Actions onto a nightly run on watson-1
 * (`command-surface/ops/ci-run.sh`), which runs `pnpm test:api` against dev,
 * staging and main. The dormant Actions workflows are deliberate estate policy,
 * NOT a defect — do not file them as one (Tom, 2026-08-31).
 *
 * These tests pin the repo-side facts that convention depends on — which globs
 * are gated, which schema grants exist — so a change to any of them is visible
 * to the nightly. They deliberately assert nothing about GitHub or about the
 * nightly's own script, neither of which lives in this repo; the coverage
 * comparison between the two gates is prose, in the audit README.
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

describe('SEC0901-X-01 [CHARACTERIZATION] — the orphaned specs now PASS, and are still off the gate', () => {
  // NOT a new finding: that `*.security-audit.ts` rides no gate is already
  // pinned by `api/_utils/securityTestMachineryIntegrity.security.test.ts`
  // ("SECURITY FINDING (gap, not fixed here)"). Do not re-file it.
  //
  // What IS new on 2026-09-01, and is the reason to act on that old gap now:
  // the 2026-08-29 audit reported all five of those specs FAILING, i.e. the
  // 2026-08-18 findings 3/4/5 still live. Run by hand today all five PASS.
  // They have silently turned from "finding open" into "regression guard for a
  // closed finding" — and a regression guard that no gate collects is the worst
  // of both worlds, because the thing it now protects is a fix someone paid for.
  //
  // This pins the shape of that argument, so it survives being forgotten.
  // Goes red when the files are renamed onto the gate. Red = CLOSED.
  const orphans = walk('api').filter((f) => f.endsWith('.security-audit.ts'))

  it('the orphaned specs are exactly the two known, and neither ends in .test.ts', () => {
    expect(orphans.sort()).toEqual([
      'api/code/validate.ipSpoof.security-audit.ts',
      'api/school/class-progress.untrustedArgs.security-audit.ts',
    ])
    for (const f of orphans) expect(f.endsWith('.test.ts')).toBe(false)
  })

  it('each now guards a CLOSED finding rather than documenting an open one', () => {
    // The tell, read from the specs themselves: they assert the SECURE
    // behaviour ("cannot repoint", "does not let x-real-ip pick the bucket"),
    // and both utilities that make those assertions true now exist. If a future
    // reader sees these fail again, the fix has regressed unnoticed.
    const ipSpoof = read('api/code/validate.ipSpoof.security-audit.ts')
    expect(ipSpoof).toMatch(/x-real-ip/i)
    const throttle = read('api/_utils/codeAttemptThrottle.ts')
    expect(throttle).toContain('x-vercel-forwarded-for')

    const args = read('api/school/class-progress.untrustedArgs.security-audit.ts')
    expect(args).toMatch(/ratchet|disjunct|inject/i)
    const progress = read('api/school/class-progress.ts')
    expect(progress).toMatch(/postgrestFilter|safeIdToken|quoteFilterValue/)
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
