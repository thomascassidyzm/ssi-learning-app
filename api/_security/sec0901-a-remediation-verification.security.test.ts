/**
 * SEC0901-A — remediation verification (2026-09-01 audit, Area A).
 *
 * Verifies the delta since the 2026-08-29 audit's base (6c2b867a) actually
 * closed what it claims to, and pins the gaps it left. Read the labels:
 * [SECURE-ASSERTION] pins a control that holds today and goes red on
 * regression. [CHARACTERIZATION] pins a still-live gap that is true today and
 * goes RED ON PURPOSE when someone fixes it — red there means CLOSED.
 *
 * Source-text assertions only — no network, no live DB, matching the
 * convention of the neighbouring reconcile-2026-08-25-*.security.test.ts files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (relPath: string) => readFileSync(resolve(repoRoot, relPath), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, out)
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.security-audit.ts')) out.push(rel)
  }
  return out
}

describe('SEC0901-A-01 [CHARACTERIZATION] — demoSchoolGraph.resolveGroupSubtreeIds still resolves by groups.path, not parent_id', () => {
  // TENANCY-01's sibling class (path-equality/prefix subtree resolution) was
  // fixed 2026-08-25 in THREE of its four named sites — invites.ts
  // (fetchSubtree), _utils/orgPlatform.ts countSubtreeMembers (descendantIds),
  // and api/school/rate-compare.ts subtreeClassIdsForGroup (descendantIds).
  // The fourth named site, _utils/demoSchoolGraph.ts resolveGroupSubtreeIds,
  // was NOT touched — it still matches on `r.path === rootPath ||
  // r.path.startsWith(rootPath + '/')`, the exact pattern TENANCY-01's own
  // fix comment (in invites.ts) describes as "two unrelated ROOT orgs sharing
  // a name get EQUAL paths" because root-org creation is self-serve.
  //
  // Reachability: resolveGroupSubtreeIds feeds discoverDemoOrgGraph(), which
  // is the sole graph resolver for api/admin/demo-schools.ts's 'expire'
  // action (bans every staffAuthUid in the resolved graph) and
  // _utils/demoSchoolTeardown.ts's purgeDemoOrg() (hard-deletes every group/
  // school/class/learner/user_tags/invite_codes row in the resolved graph,
  // then calls auth.admin.deleteUser on every staffAuthUid). A signed-in
  // caller who self-serve-creates a root org whose name slugifies to the
  // same path as an existing demo org's root causes that org's staff/data to
  // be swept into 'expire'/'purge' the next time an ssi_admin runs routine
  // demo-org cleanup on the unrelated demo org — collateral ban and
  // irreversible hard-delete of a real tenant's accounts and data, triggered
  // by an unprivileged naming collision plus a privileged admin's routine
  // action, neither of which individually looks wrong.
  it('resolveGroupSubtreeIds still compares groups.path equality/prefix (not the parent_id walk)', () => {
    const src = read('api/_utils/demoSchoolGraph.ts')
    expect(src).toContain("r.path === rootPath || (typeof r.path === 'string' && r.path.startsWith(`${rootPath}/`))")
    expect(src).not.toContain('descendantIds')
    expect(src).not.toContain("from '../_utils/groupSubtree'")
  })
  it.todo('FIX: resolveGroupSubtreeIds should call descendantIds() over a parent_id forest, same as orgPlatform.ts / rate-compare.ts / invites.ts')

  it('the graph it builds is exactly what expire (ban) and purgeDemoOrg (hard-delete) both consume unmodified', () => {
    const graphSrc = read('api/_utils/demoSchoolGraph.ts')
    expect(graphSrc).toContain('export async function discoverDemoOrgGraph(')
    expect(graphSrc).toContain('groupIds = org.group_id ? await resolveGroupSubtreeIds(supabase, org.group_id) : []')

    const adminSrc = read('api/admin/demo-schools.ts')
    expect(adminSrc).toContain("import { discoverDemoOrgGraph } from '../_utils/demoSchoolGraph'")
    expect(adminSrc).toMatch(/auth\.admin\.updateUserById\(uid, \{ ban_duration: BAN_DURATION \}\)/)

    const teardownSrc = read('api/_utils/demoSchoolTeardown.ts')
    expect(teardownSrc).toContain("import { discoverDemoOrgGraph } from './demoSchoolGraph'")
    expect(teardownSrc).toContain("await supabase.auth.admin.deleteUser(uid)")
    expect(teardownSrc).toMatch(/deleteInChunks\(supabase, 'groups', 'id', groupIds\)/)
  })
})

describe('SEC0901-A-02 [SECURE-ASSERTION] — TENANCY-01\'s other three named sites resolve subtree membership via parent_id', () => {
  it('invites.ts uses fetchSubtree (groupSubtree.ts parent_id walk)', () => {
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toContain('fetchSubtree(supabase, groupId)')
    expect(src).not.toMatch(/path\.eq\.\$\{/)
  })
  it('orgPlatform.countSubtreeMembers uses descendantIds', () => {
    const src = read('api/_utils/orgPlatform.ts')
    expect(src).toContain('descendantIds((forest ?? []) as ParentLinked[], groupId)')
  })
  it('school/rate-compare.ts subtreeClassIdsForGroup uses descendantIds at every call site', () => {
    const src = read('api/school/rate-compare.ts')
    expect(src).toContain('descendantIds(forest ?? (await loadGroupForest(svc)), groupId)')
    // Every call site funnels through the one function — grep the callers.
    const callSites = src.match(/subtreeClassIdsForGroup\(svc,/g) ?? []
    expect(callSites.length).toBeGreaterThanOrEqual(3)
  })
})

describe('SEC0901-A-03 [SECURE-ASSERTION] — cronAuth is wired into every registered cron route and no others', () => {
  // The inventory. Kept as an explicit list so that ADDING a cron is a
  // deliberate edit to this file rather than something that slips in — but the
  // authentication assertion below is now DERIVED from vercel.json rather than
  // from a second hardcoded list, so a new cron cannot be registered and left
  // unauthenticated even if somebody updates this list without thinking.
  it('vercel.json registers exactly the cron paths this repo authenticates', () => {
    const vercelJson = JSON.parse(read('vercel.json'))
    const cronPaths = (vercelJson.crons ?? []).map((c: any) => c.path).sort()
    expect(cronPaths).toEqual([
      '/api/cron/expire-demo-schools',
      '/api/cron/org-entitlement-reconcile',
      '/api/cron/org-free-year-warnings',
      '/api/cron/teacher-payouts',
    ])
  })
  it('EVERY registered cron handler calls checkCronAuth before doing any work', () => {
    const vercelJson = JSON.parse(read('vercel.json'))
    const files = (vercelJson.crons ?? []).map((c: any) => `${String(c.path).replace(/^\//, '')}.ts`)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const src = read(file)
      expect(src, file).toContain("from '../_utils/cronAuth'")
      expect(src, file).toContain('checkCronAuth(')
      expect(src, file).toMatch(/if \(!cronAuth\.ok\)/)
    }
  })
})

describe('SEC0901-A-04 [SECURE-ASSERTION] — the code-throttle bucket key is platform-attested everywhere it is used', () => {
  it('getClientIp reads only x-vercel-forwarded-for and the raw socket, never x-forwarded-for/x-real-ip', () => {
    const src = read('api/_utils/codeAttemptThrottle.ts')
    expect(src).toContain("headers['x-vercel-forwarded-for']")
    expect(src).not.toContain("headers['x-forwarded-for']")
    expect(src).not.toContain("headers['x-real-ip']")
  })
  it('every code-guessing oracle throttles through the shared module', () => {
    for (const file of [
      'api/code/validate.ts',
      'api/code/redeem.ts',
      'api/auth/possession-redeem.ts',
      'api/try-link/validate.ts',
      'api/teacher/by-code.ts',
    ]) {
      const src = read(file)
      expect(src, file).toContain("from '../_utils/codeAttemptThrottle'")
      expect(src, file).toContain('isIpOverLimit(')
      expect(src, file).toMatch(/status\(429\)/)
    }
  })
  it('no .ts file under api/ hand-rolls the old x-forwarded-for-first bucket key', () => {
    const offenders: string[] = []
    for (const rel of walk('api')) {
      if (rel.includes('/_security/') || rel === 'api/_utils/codeAttemptThrottle.ts') continue
      const src = read(rel)
      if (/x-forwarded-for.*split\(','\)\[0\]/.test(src) && /ip_hash|possession_mint_attempts/.test(src)) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('SEC0901-A-04b [SECURE-ASSERTION] — mintRateLimit.ts buckets on the platform-attested peer', () => {
  // FIXED 2026-09-07 (school-signup bot-protection review). This module used to
  // hand-roll the pre-fix getClientIp — the SAME bug class SEC25-A-01 fixed in
  // codeAttemptThrottle.ts — so a client-writable header chose the bucket.
  //
  // The old rating (MEDIUM: "the primary control, per-user, is unaffected")
  // held for the CLASS mint path, where a real teacher makes many classes on
  // one account. It did NOT hold for the SCHOOL signup path, which is the
  // threat the per-IP limit was written for: a farm cycling fresh accounts
  // creates exactly one school per account, touches the per-user limit never,
  // and so met only the per-IP bucket — the one header spoofing moved for
  // free. It now comes from the shared, hardened getClientIp.
  it('mintRateLimit.ts imports the shared hardened getClientIp and hand-rolls nothing', () => {
    const src = read('api/_utils/mintRateLimit.ts')
    expect(src).toContain("from './codeAttemptThrottle'")
    expect(src).toContain('getClientIp(req)')
    expect(src).not.toContain("req.headers['x-forwarded-for']")
    expect(src).not.toContain("req.headers['x-real-ip']")
  })
  it('every mint caller gates the throttle behind a verified caller', () => {
    // The per-user key must be the uid the platform verified — read straight
    // off verifyAuthToken / verifyAdmin / resolveGroupTreeCaller's result,
    // never off the request body. Two spellings are admitted: the property
    // access `auth.userId` / `caller.userId` / `authResult.userId` inline, or a
    // bare local that is ONLY EVER assigned from one of those results (the
    // create-class shape, where two auth lanes converge on one `callerUserId`).
    // A caller with no throttle, a throttle keyed on anything else, or a local
    // fed from any other source fails here.
    const VERIFIED = /^(auth|caller|authResult|adminResult)\.userId$/
    const callers = ['api/teacher/classes.ts', 'api/onboarding/provision.ts', 'api/school/create-class.ts']
    // The census is the module's own import list: a fourth caller that imports
    // the throttle without being listed here fails, so the list cannot go stale.
    const walk = (dir: string): string[] =>
      readdirSync(resolve(repoRoot, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [`${dir}/${e.name}`] : [],
      )
    const importers = walk('api').filter((f) => read(f).includes("from '../_utils/mintRateLimit'")).sort()
    expect(importers).toEqual([...callers].sort())
    for (const file of callers) {
      const src = read(file)
      const calls = [...src.matchAll(/enforceMintRateLimit\(\s*supabase,\s*req,\s*([\w.]+)\s*,/g)].map((m) => m[1])
      expect(calls.length, `${file}: no enforceMintRateLimit(supabase, req, <uid>, …) call`).toBeGreaterThan(0)
      // Every call, not just the first — provision.ts mints twice.
      expect(calls.length, file).toBe((src.match(/enforceMintRateLimit\(/g) ?? []).length)
      for (const key of calls) {
        if (VERIFIED.test(key)) continue
        expect(key, `${file}: throttle keyed on "${key}", which is neither a verified result nor a plain local`).toMatch(/^\w+$/)
        // A bare local: declared without an initialiser, and every assignment
        // to it is a verified result. No other source may ever reach it.
        const assignments = [...src.matchAll(new RegExp(`(?<![\\w.])${key}\\s*=\\s*([^\\n;]+)`, 'g'))].map((m) => m[1].trim())
        expect(assignments.length, `${file}: "${key}" is never assigned`).toBeGreaterThan(0)
        for (const rhs of assignments) {
          expect(rhs, `${file}: "${key}" is assigned from "${rhs}", not a verified caller`).toMatch(VERIFIED)
        }
        expect(src, `${file}: "${key}" must be declared bare, not initialised from elsewhere`).toMatch(new RegExp(`(let|const)\\s+${key}\\s*:`))
      }
    }
  })
})

describe('SEC0901-A-05 [SECURE-ASSERTION] — postgrestFilter.ts adoption: every request-derived .or()/.filter() build is either sanitised or structurally constrained', () => {
  // Census method: grep every real supabase-query-builder .or(/.filter( call
  // across api/ (excluding Array.prototype.filter, which is not the DSL), then
  // classify by hand (see docs/security-audit-2026-09-01/area-a-remediation-verification.md
  // §2 for the full table). This test pins the two shapes of "safe without the
  // helper" so a future caller who removes the constraint is caught: either the
  // interpolated value passed through a `.match(/^S\d{4}L\d{2}$/)`-style regex
  // first, or it is a uuid validated with UUID_REGEX before ever reaching the
  // string.
  it('cycles.ts pairFilter interpolates only digits captured by parseLegoId\'s anchored regex', () => {
    const src = read('api/courses/[code]/cycles.ts')
    expect(src).toContain('function parseLegoId(legoId: string): { seedNumber: number; legoIndex: number } | null {')
    expect(src).toMatch(/\/\^S\(\\d\{4\}\)L\(\\d\{2\}\)\$\//)
    expect(src).toContain('.or(pairFilter)')
  })
  it('me/legos-learnt.ts .or() interpolates only digits captured by parseLegoCursor\'s anchored regex', () => {
    const src = read('api/me/legos-learnt.ts')
    expect(src).toMatch(/\/\^S\(\\d\{4\}\)L\(\\d\+\)\//)
    expect(src).toContain('.or(')
  })
  it('groups/[id]/invites.ts .or() calls interpolate only uuids validated at entry or fetched from the DB subtree', () => {
    const src = read('api/groups/[id]/invites.ts')
    expect(src).toContain('const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i')
    expect(src).toMatch(/if \(!UUID_REGEX\.test\(groupId\)\)/)
    expect(src).toContain('.or(`group_id.in.(${groupIds.join')
  })
  it('admin/users.ts search term goes through quoteFilterValue before entering an .or() expression', () => {
    const src = read('api/admin/users.ts')
    expect(src).toContain("import { quoteFilterValue } from '../_utils/postgrestFilter'")
    expect(src).toContain('quoteFilterValue(`%${search}%`)')
  })
  it('school/class-progress.ts ratchet bounds go through safeIdToken/safeInteger before entering an .or() expression', () => {
    const src = read('api/school/class-progress.ts')
    expect(src).toContain("import { safeIdToken, safeInteger } from '../_utils/postgrestFilter'")
    expect(src).toMatch(/\.or\(`last_completed_round_index\.is\.null,last_completed_round_index\.lte\.\$\{safeRound\}`\)/)
    expect(src).toMatch(/\.or\(`last_completed_lego_id\.is\.null,last_completed_lego_id\.lt\.\$\{safeLegoId\}`\)/)
  })
})

describe('SEC0901-A-06 [CHARACTERIZATION] — SEC29-X-04 anon-key fallback: 5 named sites are now 3, no new ones found', () => {
  // 2026-08-29 named five: round-map.ts, cycles.ts, bundle.ts,
  // infplay-cycles.ts, audioAccess.ts. Re-census on today's dev: round-map.ts
  // and audioAccess.ts now FAIL CLOSED (500 / throw on a missing service
  // key). cycles.ts, bundle.ts and infplay-cycles.ts are UNCHANGED — still
  // `supabaseServiceKey || <anon key>`, which re-identifies every request on
  // that route as anon (RLS-bounded) rather than refusing to serve, the
  // instant the service-role env var is absent or mistyped in a deployed env.
  it('round-map.ts and audioAccess.ts now fail closed', () => {
    const roundMap = read('api/courses/[code]/round-map.ts')
    expect(roundMap).toMatch(/if \(!supabaseServiceKey\)/)
    expect(roundMap).not.toMatch(/supabaseServiceKey \|\|/)

    const audioAccess = read('api/_utils/audioAccess.ts')
    expect(audioAccess).toContain("throw new Error('Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY')")
  })
  it('cycles.ts, bundle.ts, infplay-cycles.ts still fall back to the anon key silently', () => {
    for (const file of [
      'api/courses/[code]/cycles.ts',
      'api/courses/[code]/bundle.ts',
      'api/courses/[code]/infplay-cycles.ts',
    ]) {
      const src = read(file)
      expect(src, file).toMatch(/supabaseServiceKey \|\|[\s\S]{0,80}ANON_KEY/)
    }
  })
  it.todo('FIX: cycles.ts / bundle.ts / infplay-cycles.ts should refuse (500) rather than silently downgrade to the anon key, same as round-map.ts / audioAccess.ts')

  it('no NEW anon-key-fallback site exists outside the three still-open ones', () => {
    const offenders: string[] = []
    for (const rel of walk('api')) {
      const src = read(rel)
      if (/supabaseServiceKey \|\|[\s\S]{0,80}ANON_KEY/.test(src)) offenders.push(rel)
    }
    expect(offenders.sort()).toEqual([
      'api/courses/[code]/bundle.ts',
      'api/courses/[code]/cycles.ts',
      'api/courses/[code]/infplay-cycles.ts',
    ])
  })
})

describe('SEC0901-A-07 [SECURE-ASSERTION] — SEC25-X-03 ssi_admin/god weak-format redemption refusal is unchanged', () => {
  it('redeem.ts refuses ABC-123-shaped ssi_admin/god codes with the same body an unknown code gets', () => {
    const src = read('api/code/redeem.ts')
    expect(src).toContain("if (codeType === 'ssi_admin' || codeType === 'god')")
    expect(src).toContain('isStrongCodeFormat(String(inviteRow.code || \'\'))')
    expect(src).toMatch(/res\.status\(200\)\.json\(\{ success: false, error: 'Invalid code' \}\)/)
  })
})
