// THROWAWAY repro probe (2026-08-15) — Tom's live report, on his phone:
// signed in, switches to airplane mode, course still plays and the UI still
// shows his account, but the guest-only "Save Progress" button appears.
//
// No login credentials available (email OTP, can't receive email), so this
// SEEDS the signed-in state directly: writes an EXPIRED supabase-js session
// into localStorage under the real sb-<project-ref>-auth-token key, then
// makes requests to Supabase HANG FOREVER (page.route intercept, never
// fulfilled) before reloading the app. That puts useAuth.initialize()
// through the exact fork Tom hit: a stored session whose access token is
// expired, and a network call to refresh it that "cannot complete" — not
// fails fast, hangs — matching the code's own 5000ms race against exactly
// that possibility.
//
// NOTE on method: a full context.setOffline(true) was tried first and
// rejected — (1) it also blocks the app's own local dev-server assets, so a
// reload can't even fetch the document (a real installed PWA would serve its
// shell from a service-worker cache instead, which this dev server doesn't
// run); (2) worse, a session with a genuinely bogus refresh_token gets
// rejected by Supabase in ~instantly *while still online* (400 "Refresh
// token is not valid"), which clears the stored session before offline mode
// ever kicks in — testing a different, unrelated fork. Routing only
// supabase.co traffic to a black hole (never abort, never fulfill) isolates
// "backend unreachable" the way it actually happens on a device that can
// still serve itself from local/cached assets but has no signal.
//
//   LD_LIBRARY_PATH=/home/tomcassidy/.ssi-sentinel-libs \
//   CHROME_BIN=<path-to-chrome> \
//   node e2e/_repro-offline-identity-2026-08-15.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || '/home/tomcassidy/SSi/ssi-learning-app/docs/'
mkdirSync(OUT, { recursive: true })

// Found by fetching the dev bundle and grepping for the supabase.co host +
// the anon-key JWT it ships (both are public, client-bundled values — not
// secrets). Confirmed by watching real REST requests fire against this host
// when the local dev server is pointed at it.
const PROJECT_REF = 'swfvymspfxmnfhevgdkg'
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

// A syntactically-plausible but garbage-signed JWT is enough — supabase-js
// decides "is this session expired" from the stored expires_at field, not by
// verifying the JWT signature client-side. exp claim is also in the past for
// belt-and-braces.
const fakeJwt = (payload) => {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.fake-signature-not-verified-client-side`
}

const now = 1755000000 // fixed, well in the past relative to 2026-08-15
const FAKE_USER_ID = '11111111-1111-4111-8111-111111111111'
const accessToken = fakeJwt({
  aud: 'authenticated',
  sub: FAKE_USER_ID,
  role: 'authenticated',
  iat: now - 7200,
  exp: now - 3600, // expired one hour before "now"
})
const session = {
  access_token: accessToken,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: now - 3600, // definitely expired
  refresh_token: 'fake-refresh-token-offline-repro',
  user: {
    id: FAKE_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'offline-repro@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const consoleLines = []
page.on('console', (msg) => {
  const line = `[${msg.type()}] ${msg.text()}`
  consoleLines.push(line)
  console.log('CONSOLE', line)
})
page.on('pageerror', (e) => {
  const line = `PAGEERROR ${String(e).slice(0, 300)}`
  consoleLines.push(line)
  console.log(line)
})
const networkAttempts = []
page.on('requestfailed', (r) => networkAttempts.push({ url: r.url(), failure: r.failure()?.errorText }))

// Clean boot first (no token), confirms the app loads normally against the
// real local dev server + real Supabase project before we touch anything.
await page.goto(BASE + '/?reset=1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

// Route every request to *.supabase.co into a black hole: never abort, never
// fulfill. The fetch just sits there, exactly like a request over a radio
// with no signal — "cannot complete", not "fails fast". Local dev-server
// requests (JS bundles, HTML) are untouched, so the reload below can still
// load the app shell — standing in for what a real installed PWA's
// service-worker cache would already guarantee offline.
await page.route('**supabase.co/**', () => {
  /* intentionally never route.abort()/route.fulfill()/route.continue() */
})

// Seed the EXPIRED session directly (bypassing supabase-js entirely) so no
// online refresh attempt ever gets a chance to reject and clear it — this is
// standing in for a real device that logged in days ago, went stale, then
// lost signal, all before this probe ever touches it.
await page.evaluate(
  ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
  { key: STORAGE_KEY, value: session },
)
const seededKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')))
console.log('SEEDED KEYS (pre-reload)', seededKeys)

// ── The actual repro: reload with a stale session + a black-holed backend. ─
consoleLines.length = 0
console.log('RELOADING with supabase.co black-holed...')
const t0 = Date.now()
await page.reload({ waitUntil: 'domcontentloaded' })
// Give the 5000ms getSession()-vs-timeout race (and anything downstream of
// it) time to resolve either way.
await page.waitForTimeout(7000)
const elapsed = Date.now() - t0

await page.screenshot({ path: OUT + 'offline-identity-repro-2026-08-15.png', fullPage: true })

const state = await page.evaluate(() => {
  const btn = document.querySelector('.guest-progress-nudge')
  return {
    guestButtonPresent: !!btn,
    guestButtonVisible: btn ? btn.getBoundingClientRect().width > 0 && btn.getBoundingClientRect().height > 0 : false,
    guestButtonText: btn ? btn.textContent.trim() : null,
    bodyText200: document.body.innerText.slice(0, 200),
    localStorageKeys: Object.keys(localStorage),
    sbAuthTokenRaw: localStorage.getItem('sb-swfvymspfxmnfhevgdkg-auth-token'),
  }
})

console.log('ELAPSED_MS', elapsed)
console.log('STATE', JSON.stringify(state, null, 2))
console.log('NETWORK_FAILURES', JSON.stringify(networkAttempts.slice(0, 10), null, 2))
console.log(
  'TIMEOUT_WARNING_FIRED',
  consoleLines.some((l) => l.includes('Session check timed out')),
)
console.log(
  'ALL_CONSOLE_LINES_OFFLINE_PHASE',
  JSON.stringify(consoleLines, null, 2),
)

await browser.close()
