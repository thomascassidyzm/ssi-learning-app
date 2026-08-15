// LIVE verification of the offline-identity fix (2026-08-15).
//
// Tom, on his phone: signed in, airplane mode, the course plays and the header
// still shows his account — and the guest-only "Save Progress" nudge appears.
//
// No login credentials here (email OTP), so the signed-in state is SEEDED:
//   - an expired supabase-js session under the real sb-<ref>-auth-token key,
//     so supabase-js must attempt a refresh;
//   - the ssi-last-known-identity record the fix writes on a confirmed boot.
// Then every supabase.co request is routed to a black hole — never fulfilled,
// never aborted — which is what a device with no signal actually looks like to
// the app: it can still serve its own shell, and the backend simply never
// answers. (context.setOffline(true) also blocks the app's own assets, so a
// reload can't even fetch the document on a non-service-worker origin.)
//
// Two cases, and the pair is the whole point:
//   A. remembered identity present → the learner resolves to their REAL
//      learners.id, the value the Save Progress nudge and every progress write
//      are keyed on;
//   B. no remembered identity → no learner at all, so a genuinely signed-out
//      person is still treated as one.
//
// The assertion is the ssi-user-id cookie, not the button: a cold probe browser
// with the backend black-holed never loads a course, so the player's controls
// (and the nudge inside them) do not render in EITHER case. The cookie is
// useAuth mirroring learner.id live, which is the actual decision under test.
// The button-level proof is Tom's own phone, where the course is cached.
//
//   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs \
//   node e2e/_verify-offline-identity-2026-08-15.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const PROJECT_REF = 'swfvymspfxmnfhevgdkg'

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeJwt = (p) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(p)}.not-verified-client-side`

const AUTH_UID = '11111111-1111-4111-8111-111111111111'
const LEARNER_ID = '22222222-2222-4222-8222-222222222222'
const past = 1755000000

const seed = {
  key: `sb-${PROJECT_REF}-auth-token`,
  session: {
    access_token: fakeJwt({ aud: 'authenticated', sub: AUTH_UID, role: 'authenticated', iat: past - 7200, exp: past - 3600 }),
    refresh_token: 'seeded-refresh-token',
    expires_at: past - 3600,
    expires_in: -3600,
    token_type: 'bearer',
    user: { id: AUTH_UID, aud: 'authenticated', role: 'authenticated', email: 'offline-probe@example.com', user_metadata: { display_name: 'Offline Probe' }, app_metadata: {} },
  },
  identity: {
    v: 1,
    learner: {
      id: LEARNER_ID,
      user_id: AUTH_UID,
      display_name: 'Offline Probe',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      preferences: { session_duration_minutes: 30, encouragements_enabled: true, learning_mode: 'fast', volume: 1 },
      verified_emails: ['offline-probe@example.com'],
    },
    authUserId: AUTH_UID,
    email: 'offline-probe@example.com',
    platformRole: null,
    educationalRole: null,
    savedAt: Date.now(),
  },
}

async function run(label, { withIdentity }) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const logs = []
  context.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))

  // Black-hole the backend: never fulfil, never abort.
  await context.route(/supabase\.co/, () => {})

  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ seed, withIdentity }) => {
      localStorage.setItem(seed.key, JSON.stringify(seed.session))
      if (withIdentity) localStorage.setItem('ssi-last-known-identity', JSON.stringify(seed.identity))
      else localStorage.removeItem('ssi-last-known-identity')
    },
    { seed, withIdentity },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  // Past the 5s session race and any settling.
  await page.waitForTimeout(12_000)

  const nudge = await page.locator('.guest-progress-nudge').count()
  const guestId = await page.evaluate(() => localStorage.getItem('ssi-guest-id'))
  const identityKept = await page.evaluate(() => !!localStorage.getItem('ssi-last-known-identity'))
  // useAuth mirrors learner.id into this cookie on every identity change, so
  // it is a live read of what learnerId resolves to — which is the value the
  // Save Progress nudge and every progress write are keyed on. A cold probe
  // browser never loads a course, so the button itself cannot render either
  // way; this is the assertion that actually distinguishes the two states.
  const userCookie = await page.evaluate(
    () => document.cookie.split('; ').find((c) => c.startsWith('ssi-user-id='))?.split('=')[1] ?? null,
  )

  console.log(`\n=== ${label} ===`)
  console.log(`learner id in flight (ssi-user-id cookie): ${userCookie ?? 'none'}`)
  console.log(`Save Progress button present: ${nudge > 0}`)
  console.log(`remembered identity still stored: ${identityKept}`)
  console.log(`guest id in storage: ${guestId ? 'yes (always minted)' : 'no'}`)
  for (const l of logs.filter((l) => l.includes('[useAuth]'))) console.log(`  ${l}`)
  await page.screenshot({ path: `/home/tomcassidy/SSi/ssi-learning-app/docs/offline-identity-${withIdentity ? 'fixed' : 'control-guest'}-2026-08-15.png` })

  await browser.close()
  return { nudge: nudge > 0, userCookie }
}

const a = await run('A. signed in, backend unreachable', { withIdentity: true })
const b = await run('B. control — genuinely signed out', { withIdentity: false })

console.log('\n--- verdict ---')
const A_OK = a.userCookie === LEARNER_ID && !a.nudge
const B_OK = b.userCookie === null
console.log(`A: offline signed-in learner resolves to their real learner id, no guest nudge: ${A_OK}`)
console.log(`B: offline signed-out learner resolves to no learner at all:                    ${B_OK}`)
process.exit(A_OK && B_OK ? 0 : 1)
