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
 * 2. `adminNextFromQuery` accepts only same-app relative paths under /admin
 *    or /methodology, and rejects protocol-relative ('//host/evil'),
 *    absolute ('https://evil') and 'javascript:' payloads. It lives in
 *    useAdminGate since 2026-09-16 (job #34) because memberSurfaceGuard needs
 *    the same answer — an ssi_admin with a cached role was ejected off
 *    /schools before the replay could run — so the lock exercises the one
 *    exported control and asserts both call sites use it, rather than
 *    scraping a regex literal out of a component.
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
import { adminNextFromQuery, deniedDestination } from '../composables/useAdminGate'

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
  const routerSrc = readFileSync(resolve(__dirname, '../router/index.ts'), 'utf8')

  // The control moved on 2026-09-16 (job #34) from a local regex inside
  // SchoolsContainer to the exported `adminNextFromQuery` in useAdminGate,
  // because memberSurfaceGuard needs the SAME answer: an ssi_admin whose role
  // was already cached was ejected from /schools to /admin/structure before
  // the replay could run, and the deep link died there. One control, two call
  // sites — so this lock now exercises the function itself rather than
  // scraping a regex literal out of a component, which is strictly stronger.
  it('accepts same-app admin/methodology paths', () => {
    expect(adminNextFromQuery({ next: '/admin' })).toBe('/admin')
    expect(adminNextFromQuery({ next: '/admin/users/123' })).toBe('/admin/users/123')
    expect(adminNextFromQuery({ next: '/admin?tab=x' })).toBe('/admin?tab=x')
    expect(adminNextFromQuery({ next: '/methodology' })).toBe('/methodology')
    expect(adminNextFromQuery({ next: '/methodology/' })).toBe('/methodology/')
  })

  it('rejects protocol-relative, absolute, and non-admin payloads', () => {
    expect(adminNextFromQuery({ next: '//evil.example/admin' })).toBeNull()
    expect(adminNextFromQuery({ next: 'https://evil.example/admin' })).toBeNull()
    expect(adminNextFromQuery({ next: 'javascript:alert(1)' })).toBeNull()
    expect(adminNextFromQuery({ next: '/adminx' })).toBeNull() // prefix match without a boundary would be a bug
    expect(adminNextFromQuery({ next: '/schools' })).toBeNull()
    expect(adminNextFromQuery({ next: '/' })).toBeNull()
    expect(adminNextFromQuery({})).toBeNull()
    expect(adminNextFromQuery({ next: ['/admin'] })).toBeNull()
  })

  it('both call sites go through that one control — no second, looser copy', () => {
    expect(src).toMatch(/adminNextFromQuery\(route\.query/)
    expect(routerSrc).toMatch(/adminNextFromQuery\(to\.query/)
    // A hand-rolled next-regex anywhere else is exactly the drift this locks.
    expect(src).not.toMatch(/\/\^\\\/\(admin\|methodology\)/)
    expect(routerSrc).not.toMatch(/\/\^\\\/\(admin\|methodology\)/)
  })

  it('the replay call uses router.replace (SPA navigation), never window.location, on the guarded target', () => {
    const replayBlock = src.slice(src.indexOf('function adminNextTarget'), src.indexOf('function adminNextTarget') + 800)
    expect(replayBlock).toMatch(/router\.replace\(target\)/)
    expect(replayBlock).not.toMatch(/window\.location/)
  })
})
