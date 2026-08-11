// @vitest-environment happy-dom
/**
 * SECURITY AUDIT 2026-08-11 — area 5 (client-config), finding CLIENT-CONFIG-04.
 *
 * The brief asks: name every client-side-only authorisation gate and pair it
 * with the server endpoint that actually enforces it.
 *
 * THE GATE. `router/index.ts` guards `/admin/**` and `/methodology/**` with:
 *
 *     const { canAccessAdmin, isInitialized, restoreFromCache } = useUserRole()
 *     restoreFromCache()
 *     if (isInitialized.value && !canAccessAdmin.value) return next('/')
 *
 * `restoreFromCache()` reads the role straight out of `localStorage`, key
 * `ssi-user-role` (useUserRole.ts:10). localStorage is fully attacker-writable
 * by its owner, so ANY visitor can run
 *
 *     localStorage.setItem('ssi-user-role', '{"platformRole":"ssi_admin"}')
 *
 * and walk through the guard into the admin routes. The tests below prove that
 * — it is a real, trivially reproducible bypass of the CLIENT gate.
 *
 * THE PAIRING (why this is not critical). Every admin route's DATA comes from
 * `/api/admin/*`, and all 19 of those endpoints re-derive the caller's role
 * SERVER-side from the Supabase JWT — either via `verifyAdmin()`
 * (api/_utils/auth.ts:88, which queries `learners.platform_role` using the
 * caller's own token) or via an inline `platform_role !== 'ssi_admin'` check.
 * A spoofed localStorage role therefore renders empty, 403-ing admin CHROME
 * and yields no data. The gate is UI convenience, correctly backed.
 *
 * That backing is the actual security control, so the second describe block
 * locks it: if a new `api/admin/*` endpoint ever ships without a server-side
 * admin check, the client gate silently becomes the only gate — and that WOULD
 * be critical. This test is the tripwire for that day.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../../..')
const API_ADMIN_DIR = resolve(REPO_ROOT, 'api/admin')

describe('the client admin gate is spoofable via localStorage (finding CLIENT-CONFIG-04)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // useUserRole holds module-level state; a fresh import per test keeps the
    // cases independent.
    vi.resetModules()
  })

  // SECURITY FINDING CLIENT-CONFIG-04: the router's admin guard trusts a value
  // the user controls. It SHOULD treat the cached role as a rendering hint
  // only and never as the authority — which it already effectively is, because
  // the server re-checks. Characterized here so the bypass is on the record.
  it('restoreFromCache() adopts an attacker-written ssi_admin role verbatim', async () => {
    window.localStorage.setItem(
      'ssi-user-role',
      JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null }),
    )

    const { useUserRole } = await import('../composables/useUserRole')
    const role = useUserRole()
    role.restoreFromCache()

    // The forged role is accepted, and the guard's predicate flips to allow.
    expect(role.platformRole.value).toBe('ssi_admin')
    expect(role.isInitialized.value).toBe(true)
    expect(role.canAccessAdmin.value).toBe(true)
  })

  it('the router guard reads that same cache, so the /admin predicate passes', () => {
    const router = readFileSync(resolve(REPO_ROOT, 'packages/player-vue/src/router/index.ts'), 'utf8')

    // Pin the exact shape of the guard this finding describes.
    expect(router).toMatch(/to\.path\.startsWith\('\/admin'\)/)
    expect(router).toMatch(/restoreFromCache\(\)/)
    expect(router).toMatch(/isInitialized\.value && !canAccessAdmin\.value/)

    // ...and confirm the cache it restores from is plain localStorage.
    const roleSrc = readFileSync(
      resolve(REPO_ROOT, 'packages/player-vue/src/composables/useUserRole.ts'),
      'utf8',
    )
    expect(roleSrc).toMatch(/const STORAGE_KEY = 'ssi-user-role'/)
    expect(roleSrc).toMatch(/localStorage\.getItem\(STORAGE_KEY\)/)
  })

  it.todo('CLIENT-CONFIG-04: treat the cached role as a hint only — re-validate against the server session before rendering admin chrome, and never let the cache alone satisfy the guard')
})

/**
 * The control that makes CLIENT-CONFIG-04 non-critical. THIS MUST STAY GREEN.
 */
describe('every /api/admin endpoint enforces admin server-side (regression lock)', () => {
  const endpoints = readdirSync(API_ADMIN_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()

  it('finds the admin endpoint set (guards against a vacuous pass)', () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(19)
  })

  it.each(endpoints)('%s verifies the caller is an SSi admin from their JWT', (file) => {
    const src = readFileSync(join(API_ADMIN_DIR, file), 'utf8')

    // Route 1: the shared helper, which verifies the token AND the role.
    const usesVerifyAdmin = /\bverifyAdmin\s*\(/.test(src)

    // Route 2: verify the token, then check platform_role/educational_role
    // inline. Both halves are required — a token check alone only proves the
    // caller is SOME signed-in learner, which is not authorisation.
    const verifiesToken = /\b(verifyAuthToken|getAuthUserId)\s*\(/.test(src)
    const checksRole = /platform_role|educational_role/.test(src)
    const usesInlineCheck = verifiesToken && checksRole

    expect(
      usesVerifyAdmin || usesInlineCheck,
      `${file} has no server-side admin check — the localStorage-spoofable client guard ` +
        `(finding CLIENT-CONFIG-04) would become the ONLY gate. Add verifyAdmin() from api/_utils/auth.ts.`,
    ).toBe(true)
  })

  it('verifyAdmin derives the role from the DB using the caller token, not from request input', () => {
    const auth = readFileSync(resolve(REPO_ROOT, 'api/_utils/auth.ts'), 'utf8')
    const fn = auth.slice(auth.indexOf('export async function verifyAdmin'))

    // Role comes from the learners table, keyed by the verified uid...
    expect(fn).toMatch(/from\('learners'\)/)
    expect(fn).toMatch(/\.eq\('user_id', authResult\.userId\)/)
    expect(fn).toMatch(/platform_role === 'ssi_admin'/)

    // ...never from a header/body the caller controls.
    expect(fn).not.toMatch(/req\.body/)
    expect(fn).not.toMatch(/req\.query/)
  })
})
