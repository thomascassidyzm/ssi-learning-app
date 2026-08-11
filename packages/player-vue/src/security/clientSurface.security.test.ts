/**
 * SECURITY AUDIT 2026-08-11 — area 5 (client-config).
 *
 * Covers the remaining client-surface findings and the controls that hold:
 *   CLIENT-CONFIG-03  eruda debug console reachable in production via ?debug
 *   CLIENT-CONFIG-08  auth refresh token parked in CacheStorage for 30 days
 *   Controls: open-redirect guard, token-never-in-URL, no postMessage
 *             listeners, service worker never caches authenticated responses.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(__dirname, '../../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry === 'security') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|ts|js)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full)
  }
  return out
}

describe('open redirect — the ?return parameter guard (control that HOLDS)', () => {
  /**
   * InstallGuide.vue is the one view that bounces to a URL taken from a query
   * parameter. Its guard rejects anything not starting with a single "/",
   * which blocks both absolute URLs and protocol-relative "//evil.com".
   */
  function returnToMirror(raw: unknown): string {
    const path = typeof raw === 'string' ? raw : ''
    return path.startsWith('/') && !path.startsWith('//') ? path : '/'
  }

  it.each([
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['///evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['http://evil.com/x', '/'],
    ['', '/'],
    [undefined, '/'],
    ['/schools/classes/abc', '/schools/classes/abc'],
    ['/', '/'],
  ])('maps %s to %s', (input, expected) => {
    expect(returnToMirror(input)).toBe(expected)
  })

  it('the live guard in InstallGuide.vue still has both halves of the check', () => {
    const src = readFileSync(join(SRC_ROOT, 'views/InstallGuide.vue'), 'utf8')
    // Dropping the `!startsWith('//')` half would reopen protocol-relative
    // off-site redirects, which is exactly the classic mistake here.
    expect(src).toMatch(/path\.startsWith\('\/'\)\s*&&\s*!path\.startsWith\('\/\/'\)/)
  })

  it('the catch-all route sends unknown paths to /, so the stale-chunk reload cannot be aimed off-site', () => {
    const router = readFileSync(join(SRC_ROOT, 'router/index.ts'), 'utf8')
    // router.onError does window.location.assign(to.fullPath). `to` is a
    // RESOLVED route, and the catch-all collapses anything unmatched to '/',
    // so fullPath can never carry an attacker's host.
    expect(router).toMatch(/path:\s*'\/:pathMatch\(\.\*\)\*'/)
    expect(router).toMatch(/redirect:\s*'\/'/)
  })
})

describe('auth tokens never reach a URL, a log, or an analytics payload (control that HOLDS)', () => {
  it('no client source puts a token in a query string', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      if (/[?&](access_token|refresh_token|auth_token|jwt)=/.test(src)) {
        offenders.push(file.slice(SRC_ROOT.length + 1))
      }
      if (/searchParams\.(set|append)\(\s*['"](access_)?token['"]/.test(src)) {
        offenders.push(file.slice(SRC_ROOT.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })

  it('no client source console-logs a token', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      if (/console\.(log|warn|error|info|debug)\([^)]*\b(access_token|refresh_token|authToken)\b/.test(src)) {
        offenders.push(file.slice(SRC_ROOT.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })

  it('tokens travel in the Authorization header, which is how the admin views call the API', () => {
    const view = readFileSync(join(SRC_ROOT, 'views/admin/AdminOnboardingView.vue'), 'utf8')
    expect(view).toMatch(/Authorization: `Bearer \$\{token\}`/)
  })
})

describe('postMessage (control that HOLDS)', () => {
  it('the app registers no window "message" listener, so there is no origin check to get wrong', () => {
    const offenders: string[] = []
    for (const file of walk(SRC_ROOT)) {
      const src = readFileSync(file, 'utf8')
      // MessageChannel port1.onmessage (used in generateLearningScript for a
      // yield-to-event-loop trick) is not a cross-origin surface; a window or
      // document 'message' listener would be.
      if (/(window|document|self)\.addEventListener\(\s*['"]message['"]/.test(src)) {
        offenders.push(file.slice(SRC_ROOT.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('service worker never caches authenticated responses (control that HOLDS)', () => {
  const viteConfig = readFileSync(resolve(REPO_ROOT, 'packages/player-vue/vite.config.js'), 'utf8')

  it('runtimeCaching covers only navigations and Google Fonts — no /api route', () => {
    // If an /api/* runtime cache is ever added, per-user authenticated JSON
    // could be served to a different signed-in user on a shared device.
    expect(viteConfig).not.toMatch(/urlPattern:.*\/api\//)
    // The font entries are written as regex literals in the config source, so
    // the dots appear backslash-escaped there.
    expect(viteConfig).toMatch(/fonts\\?\.googleapis\\?\.com/)
    expect(viteConfig).toMatch(/request\.mode === 'navigate'/)
  })

  it('audio is deliberately excluded from the service worker and from precache', () => {
    expect(viteConfig).toMatch(/\*\*\/\*\.\{mp3,wav,ogg,m4a\}/)
  })

  it('precache globs cover only static shell asset types', () => {
    expect(viteConfig).toMatch(/globPatterns:\s*\['\*\*\/\*\.\{js,css,html,svg,woff2\}'\]/)
  })
})

describe('the eruda debug console gate (finding CLIENT-CONFIG-03)', () => {
  const mainJs = readFileSync(join(SRC_ROOT, 'main.js'), 'utf8')

  /**
   * Mirror of the live gate in main.js:30-32.
   */
  function debugToolsEnabled(hostname: string, search: string): boolean {
    return hostname.includes('vercel.app') || search.includes('debug')
  }

  it('the mirrored gate matches the live source', () => {
    expect(mainJs).toMatch(/location\.hostname\.includes\('vercel\.app'\)/)
    expect(mainJs).toMatch(/location\.search\.includes\('debug'\)/)
  })

  // SECURITY FINDING CLIENT-CONFIG-03: main.js:19-21 states the debug console
  // is for "preview deploys (*.vercel.app) or ?debug only, NEVER production" —
  // but the gate has no production carve-out, so ?debug switches on a full
  // on-screen console/network inspector on saysomethingin.app too. The intent
  // in the comment and the behaviour of the code disagree.
  it('IS currently enabled on production when ?debug is present', () => {
    expect(debugToolsEnabled('saysomethingin.app', '?debug=1')).toBe(true)
  })

  // The match is a loose substring test, so unrelated params switch it on.
  it.each(['?nodebug=1', '?x=debugging', '?utm_source=debug-newsletter'])(
    'is also switched on by the unrelated query string %s',
    (search) => {
      expect(debugToolsEnabled('saysomethingin.app', search)).toBe(true)
    },
  )

  it('the hostname half is also a loose substring match', () => {
    // A lookalike host containing the literal "vercel.app" would satisfy it.
    expect(debugToolsEnabled('vercel.app.evil.example', '')).toBe(true)
  })

  it('stays off for a plain production visit', () => {
    expect(debugToolsEnabled('saysomethingin.app', '')).toBe(false)
    expect(debugToolsEnabled('saysomethingin.app', '?fc=1')).toBe(false)
  })

  it.todo("CLIENT-CONFIG-03: gate eruda on an exact production check (import.meta.env.PROD / exact hostname) and match the query param exactly (URLSearchParams.has('debug')), so the code matches its own 'NEVER production' comment")
})

describe('auth hand-off across the Safari → PWA boundary (finding CLIENT-CONFIG-08)', () => {
  const handoff = readFileSync(join(SRC_ROOT, 'utils/authHandoff.ts'), 'utf8')

  // SECURITY FINDING CLIENT-CONFIG-08: a refresh token is written to
  // CacheStorage and accepted for up to 30 days. CacheStorage is same-origin
  // and no more exposed than the localStorage Supabase already uses, and the
  // mitigations below are real — but 30 days is a long life for a refresh
  // token sitting in a non-obvious place on a shared device.
  it('parks the refresh token in CacheStorage with a 30-day acceptance window', () => {
    expect(handoff).toMatch(/refresh_token/)
    expect(handoff).toMatch(/const CACHE_NAME = 'ssi-auth-handoff'/)
    expect(handoff).toMatch(/MAX_AGE_MS = 1000 \* 60 \* 60 \* 24 \* 30/)
  })

  it('mitigations hold: consume-once, and cleared on sign-out', () => {
    // The read deletes the entry before validating it, so a stale token is
    // never left behind even on a failed restore.
    expect(handoff).toMatch(/await cache\.delete\(HANDOFF_KEY\)[\s\S]{0,80}if \(!res\) return null/)
    // Passing null clears the bridge — this is the sign-out path.
    expect(handoff).toMatch(/if \(!tokens\?\.access_token \|\| !tokens\?\.refresh_token\) \{[\s\S]{0,60}cache\.delete/)
  })

  it.todo('CLIENT-CONFIG-08: shorten the hand-off window well below 30 days — it only needs to survive an Add-to-Home-Screen, which is minutes')
})
