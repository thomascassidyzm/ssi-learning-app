/**
 * SECURITY AUDIT 2026-08-25 — Area B (client), JOB 1 prime suspect.
 *
 * useAdminGate.ts (CHANGED since 08-11) added `deniedDestination`, which
 * sends a signed-out visitor hitting an /admin deep link to
 * `/schools?next=<fullPath>`. SchoolsContainer.vue then replays `next` once
 * the caller's role resolves to ssi_admin (`adminNextTarget` +
 * `router.replace(target)`). Any place a query param becomes a navigation
 * target is an open-redirect candidate, so this suite locks both halves:
 *
 * 1. `deniedDestination` only ever produces '/' or a same-origin '/schools'
 *    path object — it never echoes an arbitrary string back as a bare
 *    navigation target itself.
 * 2. `SchoolsContainer.vue`'s replay regex accepts only same-app relative
 *    paths under /admin or /methodology, and rejects protocol-relative
 *    ('//host/evil'), absolute ('https://evil'), and 'javascript:' payloads.
 *    (This is a source-level lock rather than a mount, because
 *    `adminNextTarget` is a local, unexported function — the regex itself is
 *    the control, and it is what the 08-11 audit's own note on `next`
 *    params — CLIENT-CONFIG-01's referrer-leakage discussion — flagged as
 *    the class of bug to watch for.)
 *
 * VERDICT: both halves hold. `router.replace(target)` also cannot itself be
 * an open redirect even if the regex were looser, because vue-router
 * resolves a string target against the app's own route table rather than
 * navigating the raw string as a URL — but the regex is the documented,
 * intentional control, so it is what this suite locks.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deniedDestination } from '../composables/useAdminGate'

describe('deniedDestination — never echoes an arbitrary redirect target', () => {
  it('a guest is sent to /schools with next carrying the ORIGINAL fullPath, unmodified but not itself used as a bare navigation string', () => {
    const dest = deniedDestination('guest', '/admin/users/123')
    expect(dest).toEqual({ path: '/schools', query: { next: '/admin/users/123' } })
  })

  it('a signed-in non-admin (authenticated) always goes to "/" — next is dropped entirely', () => {
    expect(deniedDestination('authenticated', '/admin/users/123')).toBe('/')
    expect(deniedDestination('authenticated', 'https://evil.example/phish')).toBe('/')
  })

  it('an attacker-controlled fullPath is carried as DATA (a query value), never interpolated into a URL string here', () => {
    const evil = '//evil.example/phish'
    const dest = deniedDestination('guest', evil)
    expect(typeof dest).toBe('object')
    expect((dest as { query: { next: string } }).query.next).toBe(evil)
    // The object form is what makes this safe: vue-router's route-object
    // navigation never treats `query.next` as anything but a query string
    // value on /schools. The actual gate against `evil` reaching a real
    // navigation lives in SchoolsContainer's replay regex, locked below.
  })
})

describe('SchoolsContainer.vue — the next-param replay regex rejects everything but a same-app admin/methodology path', () => {
  const src = readFileSync(
    resolve(__dirname, '../containers/SchoolsContainer.vue'),
    'utf8',
  )

  // Pull the exact regex literal out of source so the test tracks the real
  // control rather than a hand-copied approximation of it.
  const regexMatch = src.match(/function adminNextTarget[\s\S]*?if \(!(\/\^[\s\S]*?\/)\.test\(next\)\) return null/)
  const regexSource = regexMatch?.[1]
  it('the guard regex is present in source (regression lock — if this fails, the control moved or was removed)', () => {
    expect(regexSource, 'expected to find the /^\\/(admin|methodology).../ guard regex in SchoolsContainer.vue').toBeDefined()
  })

  // Reconstructing the literal regex the component actually uses, from its
  // own source text, is the point of this lock: it fails loudly if the
  // pattern is ever loosened.
  const guard = regexSource ? (eval(regexSource) as RegExp) : null

  it.runIf(guard)('accepts same-app admin/methodology paths', () => {
    expect(guard!.test('/admin')).toBe(true)
    expect(guard!.test('/admin/users/123')).toBe(true)
    expect(guard!.test('/admin?tab=x')).toBe(true)
    expect(guard!.test('/methodology')).toBe(true)
    expect(guard!.test('/methodology/')).toBe(true)
  })

  it.runIf(guard)('rejects protocol-relative, absolute, and non-admin payloads', () => {
    expect(guard!.test('//evil.example/admin')).toBe(false)
    expect(guard!.test('https://evil.example/admin')).toBe(false)
    expect(guard!.test('javascript:alert(1)')).toBe(false)
    expect(guard!.test('/adminx')).toBe(false) // prefix match without a boundary would be a bug
    expect(guard!.test('/schools')).toBe(false)
    expect(guard!.test('/')).toBe(false)
  })

  it('the replay call uses router.replace (SPA navigation), never window.location, on the guarded target', () => {
    const replayBlock = src.slice(src.indexOf('function adminNextTarget'), src.indexOf('function adminNextTarget') + 800)
    expect(replayBlock).toMatch(/router\.replace\(target\)/)
    expect(replayBlock).not.toMatch(/window\.location/)
  })
})
