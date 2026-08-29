/**
 * SECURITY AUDIT 2026-08-29 — Area D (client, second pass): sinks, tokens,
 * and the browser-direct read surface.
 *
 * See docs/security-audit-2026-08-29/area-d-client.md for the full writeup.
 * This file locks the two real findings (SEC29-D-01, SEC29-D-02) as
 * characterization tests (they PASS today, describing the insecure/gappy
 * behaviour; they go red the day someone fixes it — that is the signal),
 * plus regression locks for the controls this pass verified as holding.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const REPO_ROOT = resolve(__dirname, '../../../..')
const SRC = resolve(REPO_ROOT, 'packages/player-vue/src')

function read(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf8')
}

// ---------------------------------------------------------------------------
// SEC29-D-01 (medium): admin_practice_minutes_by_course is SECURITY DEFINER,
// granted to `authenticated` (every signed-in learner, not just admins), and
// its body performs NO caller-role check — unlike its analytics_* siblings,
// which all gate on is_god_user(). Any authenticated browser session can
// call it directly (bypassing player_events' own-row RLS by construction)
// and pull platform-wide or per-learner-id aggregate practice minutes.
// ---------------------------------------------------------------------------
describe('SEC29-D-01: admin_practice_minutes_by_course has no internal role gate', () => {
  const migrations = [
    'supabase/migrations/20260619_admin_practice_minutes_by_course_rpc.sql',
    'supabase/migrations/20260717a_practice_minutes_from_sessions.sql',
    'supabase/migrations/20260717c_position_derived_time_fallback.sql',
  ]

  it('is granted to `authenticated` (not just service_role) in every version of the function', () => {
    for (const path of migrations) {
      const sql = read(path)
      expect(sql).toMatch(
        /grant execute on function public\.admin_practice_minutes_by_course\([^)]*\)\s+to\s+service_role,\s*authenticated;/i,
      )
    }
  })

  it('the latest (2026-07-17) definition performs no is_god_user()/admin check before returning data', () => {
    const sql = read('supabase/migrations/20260717c_position_derived_time_fallback.sql')
    const fnStart = sql.indexOf('create or replace function public.admin_practice_minutes_by_course')
    expect(fnStart).toBeGreaterThan(-1)
    const fnBody = sql.slice(fnStart, sql.indexOf('$$;', fnStart) + 3)
    expect(fnBody).toMatch(/security definer/i)
    // SECURITY FINDING SEC29-D-01: no caller-role gate anywhere in the body —
    // any authenticated caller passing p_learner_ids=null gets every
    // learner's aggregate practice minutes per course, platform-wide.
    expect(fnBody).not.toMatch(/is_god_user\s*\(\s*\)|is_ssi_admin\s*\(\s*\)/i)
    expect(fnBody).not.toMatch(/RAISE EXCEPTION/i)
  })

  it('control HOLDS: sibling analytics_* SECURITY DEFINER RPCs DO gate on is_god_user()', () => {
    const schema = read('supabase/schema.sql')
    const gatedFunctions = [
      'analytics_health',
      'analytics_overview',
      'analytics_entitlement_funnel',
      'analytics_trial_conversion',
    ]
    for (const name of gatedFunctions) {
      const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
      expect(start, `${name} should exist in schema.sql`).toBeGreaterThan(-1)
      const end = schema.indexOf('\n$$;', start)
      const body = schema.slice(start, end)
      // Two equivalent admin-gate helpers are used across the schema
      // (is_god_user / is_ssi_admin, the latter post-dating the 2026-06-16
      // god→ssi_admin collapse) — either is an internal caller-role check.
      expect(body, `${name} should gate on is_god_user()/is_ssi_admin()`).toMatch(
        /is_god_user\s*\(\s*\)|is_ssi_admin\s*\(\s*\)/i,
      )
    }
  })

  it('is called directly from browser (anon-key) composables/views, not just via a server endpoint', () => {
    const callers = [
      'packages/player-vue/src/views/schools/StudentProgressView.vue',
      'packages/player-vue/src/composables/schools/useAnalyticsData.ts',
      'packages/player-vue/src/composables/admin/useAdminUserDetail.ts',
      'packages/player-vue/src/composables/admin/useAdminCourses.ts',
    ]
    for (const path of callers) {
      const src = readFileSync(resolve(REPO_ROOT, path), 'utf8')
      expect(src, `${path} should call the RPC directly`).toMatch(
        /\.rpc\(\s*['"]admin_practice_minutes_by_course['"]/,
      )
    }
  })

  // it.todo('admin_practice_minutes_by_course gates on is_god_user() (or an
  // equivalent caller-scope check) before returning any row, exactly like
  // analytics_health/analytics_overview/analytics_entitlement_funnel do —
  // OR the browser call sites are repointed to a server-mediated endpoint
  // that enforces resolveVisibleScope, and the RPC's authenticated grant is
  // narrowed to service_role only.')
  it.todo(
    'FIX: admin_practice_minutes_by_course gates on is_god_user() (matching its analytics_* siblings), or is called only through a server-mediated endpoint with the authenticated grant revoked',
  )
})

// ---------------------------------------------------------------------------
// SEC29-D-02 (low): premium/paid audio persists in IndexedDB across
// signOut() and is served from cache without any entitlement re-check —
// a subsequent signed-out/unpaid user on the same device/browser profile
// can still hear content a prior paying learner already cached.
// ---------------------------------------------------------------------------
describe('SEC29-D-02: signOut() does not clear the audio IndexedDB cache', () => {
  it('useAuth.signOut() clears auth storage, role cache, subscription/entitlement caches — but never touches AudioCache/IndexedDB', () => {
    const src = read('packages/player-vue/src/composables/useAuth.ts')
    const start = src.indexOf('async function signOut(')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\n  }', start)
    const body = src.slice(start, end)
    expect(body).toMatch(/purgeSupabaseAuthStorage\(\)/)
    expect(body).toMatch(/useUserRole\(\)\.clear\(\)/)
    expect(body).toMatch(/useSharedSubscription\(\)\.clearCache\(\)/)
    expect(body).toMatch(/useSharedUserEntitlements\(\)\.clearCache\(\)/)
    // SECURITY FINDING SEC29-D-02: no audio-cache/IndexedDB teardown here.
    expect(body).not.toMatch(/getAudioCache|AudioCache|deleteIndexedDbs|indexedDB\.deleteDatabase/)
  })

  it('cached playback (resolveCachedPlaybackUrl) serves IndexedDB bytes with no entitlement re-check, keyed only by content id', () => {
    const src = read('packages/player-vue/src/cache/resolvePlaybackUrl.ts')
    // Content-id keyed lookup only — no learner/session/entitlement parameter.
    expect(src).toMatch(/getWavBlobUrl\(id\)/)
    expect(src).not.toMatch(/learnerId|userId|entitlement|auth\.uid|getSession/)
  })

  it('the IndexedDB audio cache is a single shared database, not namespaced per learner/session', () => {
    const src = read('packages/player-vue/src/cache/AudioCache.ts')
    expect(src).toMatch(/DB_NAME\s*=\s*['"]ssi-audio-cache-v2['"]/)
    expect(src).not.toMatch(/learnerId|userId|auth\.uid/)
  })

  it.todo(
    'FIX: signOut() clears (or re-validates against a fresh entitlement check) the persistent AudioCache namespace, so a subsequent user on the same device cannot play a prior paying learner\'s cached premium audio',
  )
})

// ---------------------------------------------------------------------------
// D1 — sink sweep: both v-html usages in the repo are locked as SAFE
// (repo-authored compiled JSON, escaped before a bounded **bold** rewrite,
// never fed by a prop that can carry user/DB-authored text).
// ---------------------------------------------------------------------------
describe('D1: the only two v-html sinks in the client stay pinned to escaped, repo-authored content', () => {
  it('HowThisWorks.vue escapes & < > before its bounded **bold** rewrite, sourced from the compiled pack.json only', () => {
    const src = read('packages/player-vue/src/components/admin/HowThisWorks.vue')
    expect(src).toMatch(/import pack from '@\/explainer\/pack\.json'/)
    expect(src).toMatch(/replace\(\/&\/g, '&amp;'\)/)
    expect(src).toMatch(/replace\(\/<\/g, '&lt;'\)/)
    expect(src).toMatch(/v-html="html"/)
  })

  it('WalkCard.vue escapes & < > before its bounded **bold** rewrite of the `say` prop', () => {
    const src = read('packages/player-vue/src/components/admin/WalkCard.vue')
    expect(src).toMatch(/replace\(\/&\/g, '&amp;'\)/)
    expect(src).toMatch(/v-html="rendered"/)
  })

  it('every WalkCard `say`/`:say` caller sources it from the repo-authored walkthrough pack.json, never from a DB row', () => {
    const overlaySrc = read('packages/player-vue/src/components/admin/WalkOverlay.vue')
    expect(overlaySrc).toMatch(/currentStep\.value\?\.say/)
    const gateSrc = read('packages/player-vue/src/components/admin/ManagerOnboardingGate.vue')
    expect(gateSrc).toMatch(/walk\.value\.say/)
    const engineSrc = read('packages/player-vue/src/walkthrough/useWalkthrough.ts')
    expect(engineSrc).toMatch(/import pack from '\.\/pack\.json'/)
  })

  it('control HOLDS: no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function anywhere in client source', () => {
    const forbidden = /innerHTML|outerHTML|insertAdjacentHTML|document\.write\(|(?<![\w.])eval\(|new Function\(/
    const out = execSync(
      `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\\.write\\(|new Function\\(" ${SRC} --include=*.ts --include=*.vue --include=*.js || true`,
      { encoding: 'utf8' },
    )
    const offenders = out
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.includes('.test.') && !/\/\/.*document\.write/.test(line))
    expect(offenders).toEqual([])
    void forbidden
  })

  it('control HOLDS: no window/document "message" event listener anywhere in client source (no postMessage origin-check bug to have)', () => {
    const out = execSync(
      `grep -rnE "addEventListener\\(['\\"]message" ${SRC} --include=*.ts --include=*.vue || true`,
      { encoding: 'utf8' },
    )
    expect(out.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// D2 — token/secret handling: no server secret pattern in client source; all
// VITE_* vars are the known legitimately-public set (regression lock so a
// newly-added VITE_* secret is caught).
// ---------------------------------------------------------------------------
describe('D2: no server secret reaches client source; VITE_* surface is the known public set', () => {
  it('no service-role/Paddle-secret/AWS-secret/Resend/Cron secret pattern appears in client source (outside test fixtures)', () => {
    const out = execSync(
      `grep -rniE "service_role|sk_live|sk_test|AWS_SECRET|AWS_ACCESS_KEY|PADDLE_API|PADDLE_SECRET|RESEND_API|CRON_SECRET" ${SRC} --include=*.ts --include=*.vue --include=*.js || true`,
      { encoding: 'utf8' },
    )
    const offenders = out
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.includes('.test.'))
      // Comments naming a SERVER-side env var (explaining why something must
      // NOT run client-side) are not a leaked secret VALUE — only flag lines
      // that look like an actual assignment/literal.
      .filter((l) => /=\s*['"`][^'"`]{8,}['"`]|process\.env|import\.meta\.env/.test(l))
    expect(offenders).toEqual([])
  })

  it('the try-link entitlement token is sent only via Authorization header, never in a URL/query string', () => {
    const src = read('packages/player-vue/src/playback/bulkAudioDownload.ts')
    expect(src).toMatch(/sessionStorage\.getItem\('ssi-try-token'\)/)
    // it must reach the request as a bearer, not appended to a URL
    expect(src).not.toMatch(/[?&]token=\$\{.*tryToken/)
  })

  it('the try-link token is scoped to sessionStorage (tab-lifetime), not localStorage', () => {
    const src = read('packages/player-vue/src/views/TryLinkGateway.vue')
    expect(src).toMatch(/sessionStorage\.setItem\('ssi-try-token'/)
    expect(src).not.toMatch(/localStorage\.setItem\('ssi-try-token'/)
  })
})

// ---------------------------------------------------------------------------
// D3 — direct browser-Supabase reads against the seven org tables named in
// CLAUDE.md's RLS-tightening precondition. This count is a regression lock:
// it should trend toward zero as reads are repointed to server endpoints on
// the resolveVisibleScope pattern, and this test goes red (in the good
// direction — the count assertion is exact, so ANY change, up or down,
// forces a deliberate update) when that repointing happens.
// ---------------------------------------------------------------------------
describe('D3: direct browser reads of RLS-dependent org tables (CLAUDE.md precondition #2)', () => {
  function countDirectReads(table: string): number {
    const out = execSync(
      `grep -rnE "from\\('${table}'\\)|from\\(\\"${table}\\"\\)" ${SRC} --include=*.ts --include=*.vue || true`,
      { encoding: 'utf8' },
    )
    return out.split('\n').filter((l) => l.trim() && !l.includes('.test.')).length
  }

  // Snapshot at time of writing (2026-08-29). If this test goes red, either a
  // new direct read was added (bad — repointing should only ever go down) or
  // an existing one was repointed to a server endpoint (good — update the
  // count and note it in the audit doc's follow-up).
  const expectedCounts: Record<string, number> = {
    schools: 12,
    classes: 13,
    groups: 5,
    govt_admins: 1,
    invite_codes: 0,
    entitlement_grants: 2,
    user_tags: 6,
  }

  for (const [table, expected] of Object.entries(expectedCounts)) {
    it(`${table}: ${expected} direct browser read call site(s)`, () => {
      expect(countDirectReads(table)).toBe(expected)
    })
  }

  it('total across the seven org tables is 39 (the measure CLAUDE.md\'s RLS-tightening precondition #2 tracks)', () => {
    const total = Object.keys(expectedCounts).reduce((sum, t) => sum + countDirectReads(t), 0)
    expect(total).toBe(39)
  })

  it('client-side role state (useUserRole) is explicitly a spoofable cache, not the trust boundary — RLS is the only real backstop for these 39 reads', () => {
    const src = read('packages/player-vue/src/composables/useUserRole.ts')
    expect(src).toMatch(/DB is source of truth,\s*\n\s*\* localStorage is a fast cache/)
  })

  it('useCourseAccess.ts (2 of the entitlement_grants reads) is dead code — no functional callers besides its own definition', () => {
    const out = execSync(
      `grep -rn "= useCourseAccess()\\|useCourseAccess()\\." ${SRC} --include=*.ts --include=*.vue | grep -v "useCourseAccess.ts:" || true`,
      { encoding: 'utf8' },
    )
    expect(out.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// D4 — service worker: confirm the control the 08-25 report already noted
// still holds — no /api/* runtimeCaching route, so no shared-cache
// cross-user replay is possible via the SW layer specifically.
// ---------------------------------------------------------------------------
describe('D4: service worker runtime caching never covers /api/* (no cross-user shared-cache replay via the SW)', () => {
  it('vite.config.js runtimeCaching has no urlPattern matching /api/', () => {
    if (!existsSync(resolve(REPO_ROOT, 'packages/player-vue/vite.config.js'))) {
      throw new Error('vite.config.js moved — update this test path')
    }
    const src = read('packages/player-vue/vite.config.js')
    const start = src.indexOf('runtimeCaching:')
    const end = src.indexOf('manifest:', start)
    const block = src
      .slice(start, end)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(block).not.toMatch(/urlPattern.*\/api\//)
    expect(block).not.toMatch(/['"]\/api\//)
  })
})
