/**
 * SECURITY AUDIT 2026-08-11 — area 5 (client-config), findings
 * CLIENT-CONFIG-02 (git-history env leak) and CLIENT-CONFIG-07 (bundle secrets).
 *
 * The critical question for a Vite SPA is: can a server-side secret reach the
 * browser bundle? Anything read via `import.meta.env.VITE_*` is INLINED into
 * shipped JavaScript at build time and is public by definition. These tests
 * are regression locks on the answer being "no".
 *
 * Verified at audit time: the only VITE_ values are the Supabase URL + anon
 * (publishable) key, S3 public audio base/bucket/region, feature flags, and
 * Paddle CLIENT token + price ids — every one of which is designed to be
 * public. No service-role key, AWS secret, Paddle API key or Resend key is
 * reachable from client code.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const SRC_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(__dirname, '../../../..')

/**
 * Walk only code that can actually be SHIPPED to the browser. Excluded:
 *  - `*.test.ts` / `__tests__/` — vitest-only, never bundled. `src/__tests__/api/`
 *    in particular holds node-side API tests that legitimately reference
 *    SUPABASE_SERVICE_ROLE_KEY via process.env; treating those as client code
 *    would make this suite cry wolf.
 *  - `security/` — this audit's own files, which name the forbidden patterns.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry === 'security') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|ts|js)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full)
  }
  return out
}

/** Every `import.meta.env.VITE_FOO` name referenced anywhere in client source. */
function referencedViteVars(): string[] {
  const names = new Set<string>()
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) names.add(m[1])
  }
  return [...names].sort()
}

describe('client bundle — no server secret is reachable from VITE_ env', () => {
  /**
   * The blast-radius test. A VITE_ var whose name implies a server credential
   * would be inlined into public JS. SUPABASE_SERVICE_ROLE_KEY in particular
   * bypasses every RLS policy in the database, so this is the single most
   * important assertion in the client-side audit.
   */
  const FORBIDDEN = [
    /SERVICE_ROLE/,
    /SERVICE_KEY/,
    /AWS_SECRET/,
    /SECRET_ACCESS_KEY/,
    /PADDLE_API_KEY/,
    /PADDLE_.*WEBHOOK.*SECRET/,
    /RESEND_API_KEY/,
    /_PRIVATE_KEY/,
  ]

  it('no VITE_ variable name matches a server-secret pattern', () => {
    const referenced = referencedViteVars()
    expect(referenced.length).toBeGreaterThan(0) // guard against a vacuous pass

    const offenders = referenced.filter((name) => FORBIDDEN.some((re) => re.test(name)))
    expect(offenders).toEqual([])
  })

  it('client source never reads a non-VITE server env var (Vite would leave it undefined, or a plugin could inline it)', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      // process.env.SOMETHING_SECRET-ish references in browser code.
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (/SERVICE_ROLE|SERVICE_KEY|AWS_SECRET|SECRET|API_KEY|PRIVATE_KEY/.test(m[1])) {
          offenders.push(`${file.slice(SRC_ROOT.length + 1)}: ${m[1]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the Supabase key the client uses is the anon/publishable one, never the service role', () => {
    const env = readFileSync(join(SRC_ROOT, 'config/env.ts'), 'utf8')
    expect(env).toMatch(/VITE_SUPABASE_ANON_KEY/)
    expect(env).not.toMatch(/SERVICE_ROLE/)
  })

  it('no long literal JWT / AWS access-key id is hard-coded in client source', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      // A literal Supabase/GoTrue JWT, or an AWS access key id.
      if (/eyJhbGciOi[A-Za-z0-9_-]{40,}/.test(src)) offenders.push(`${file}: literal JWT`)
      if (/\bAKIA[0-9A-Z]{16}\b/.test(src)) offenders.push(`${file}: AWS access key id`)
    }
    expect(offenders).toEqual([])
  })
})

describe('repo hygiene — env files must never be tracked', () => {
  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  }

  it('no .env file is tracked in the working tree', () => {
    const tracked = git(['ls-files']).split('\n').filter(Boolean)
    const envFiles = tracked.filter((p) => /(^|\/)\.env($|\.)/.test(p))
    expect(envFiles).toEqual([])
  })

  /**
   * SECURITY FINDING CLIENT-CONFIG-02: `.env.prod` and `.env.vercel` WERE
   * committed (13bfdc1d, 2026-01-27 01:02) and removed 65 seconds later
   * (218f34cc). Git history still contains them, so anyone who can clone the
   * repo can read them with `git show 13bfdc1d:.env.prod`.
   *
   * Contents audited: a VERCEL_OIDC_TOKEN (JWT, exp 2026-01-27 12:54Z — long
   * expired), plus VITE_CLERK_PUBLISHABLE_KEY, VITE_SUPABASE_ANON_KEY and S3
   * public config, all of which are publishable by design. NO service-role
   * key, AWS secret or Paddle/Resend key was ever committed.
   *
   * This test characterizes the leak as still-present in history so it cannot
   * be quietly forgotten. It passes today; it will start failing only if the
   * history is rewritten, which is the desired end state.
   */
  it('records that .env.prod/.env.vercel remain recoverable from git history (finding CLIENT-CONFIG-02)', () => {
    const added = git(['log', '--all', '--diff-filter=A', '--name-only', '--pretty=format:'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    expect(added).toContain('.env.prod')
    expect(added).toContain('.env.vercel')

    // Still readable from the historical blob...
    const leaked = git(['show', '13bfdc1d:.env.vercel'])
    expect(leaked).toMatch(/VERCEL_OIDC_TOKEN=/)

    // ...but the one true credential in it is an OIDC token that expired on
    // 2026-01-27, and no service-role/AWS secret was ever present.
    const prod = git(['show', '13bfdc1d:.env.prod'])
    expect(prod).not.toMatch(/SERVICE_ROLE/)
    expect(prod).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/)
    expect(prod).not.toMatch(/AWS_SECRET_ACCESS_KEY=\S/)
  })

  it('.gitignore covers env files so this cannot recur by accident', () => {
    const gitignorePath = resolve(REPO_ROOT, '.gitignore')
    expect(existsSync(gitignorePath)).toBe(true)
    expect(readFileSync(gitignorePath, 'utf8')).toMatch(/\.env/)
  })

  it.todo('CLIENT-CONFIG-02: purge .env.prod/.env.vercel from git history (filter-repo) and rotate anything that was ever in them')
})
