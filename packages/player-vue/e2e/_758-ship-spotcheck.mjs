// Job #758 — production spot-check after the 2026-09-15 schools ship.
// Signs in as the ZZ Test teacher-only persona (thomas.cassidy+mrtomtester@gmail.com,
// teacher on "Y7 Welsh" in the ZZ Test school) via a minted magic link, then asserts on
// https://saysomethingin.app: the served build is the promoted one, a teacher lands on the
// dashboard, Play as class is present, the support door answers, one class Insights page loads.
//   set -a; . ~/.secrets/ssi-dashboard.env; set +a
//   EXPECT_BUILD=bfda61b node e2e/_758-ship-spotcheck.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_SERVICE_KEY
const EMAIL = process.env.PROBE_EMAIL || 'thomas.cassidy+mrtomtester@gmail.com'
const LEADER_EMAIL = process.env.LEADER_EMAIL || 'thomas.cassidy+chepstowtest-leader@gmail.com'
const CLASS_ID = process.env.PROBE_CLASS_ID || 'd52efceb-da67-413b-a660-9fbe6c48a494'
const OUT = process.env.CS_SCRATCH || '/home/tomcassidy/.tmpbig'
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const version = await (await fetch(`${BASE}/version.json`, { cache: 'no-store' })).json()
check('served build is the promoted commit', version.buildNumber === (process.env.EXPECT_BUILD || 'bfda61b'), JSON.stringify(version))

const j = await (await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
const sess = await (await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: j.hashed_token }) })).json()
check('minted a session for the teacher persona', !!sess.access_token, sess.error || sess.msg || '')
const KEY = `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(sess)])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const api = []
page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) api.push(`${r.request().method()} ${u.pathname}${u.search} ${r.status()}`) })
const dismissLater = async () => { const b = page.getByRole('button', { name: 'Later', exact: true }); if (await b.count()) await b.first().click().catch(() => {}) }

// 1. A teacher account opens with the dashboard, not the player. The rule reads the CACHED
// role (localStorage ssi-user-role, written on the first learner-row fetch), so a fresh device's
// very first open reaches the player once by design; the second open must land on /schools.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(8000); await dismissLater(); await page.waitForTimeout(1500)
const cachedRole = await page.evaluate(() => localStorage.getItem('ssi-user-role'))
check('first open wrote the teacher role cache', /"educationalRole":"teacher"/.test(cachedRole || ''), cachedRole || 'null')
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(8000); await dismissLater(); await page.waitForTimeout(1500)
check('teacher lands on the schools dashboard on the next open', page.url().includes('/schools'), page.url())
await page.screenshot({ path: `${OUT}/758-1-teacher-home.png`, fullPage: true })

// 2. Play as class is present on the teacher home.
const bodyHome = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const pac = page.locator('button', { hasText: /Play as class/i })
check('Play as class button present', (await pac.count()) >= 1, `count=${await pac.count()}`)
check('no LEGO wording on the teacher home', !/\bLEGO/i.test(bodyHome))

// 3. The support door answers — for the school admin persona (Tom, 2026-09-10: the in-app
// support channel is for admins only, not individual teachers; a teacher gets 403 by design).
const teacherSupport = await page.evaluate(async () => { const r = await fetch('/api/support/thread?peek=1', { headers: { Authorization: 'Bearer ' + JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('-auth-token')))).access_token } }); return r.status })
check('teacher is refused the admin support channel by design', teacherSupport === 403, `status=${teacherSupport}`)
{
  const lj = await (await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: LEADER_EMAIL }) })).json()
  const lsess = await (await fetch(`${SB_URL}/auth/v1/verify`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', token_hash: lj.hashed_token }) })).json()
  check('minted a session for the school admin persona', !!lsess.access_token, lsess.error || lsess.msg || '')
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await lctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(lsess)])
  const lpage = await lctx.newPage()
  const lcalls = []
  lpage.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/support/')) lcalls.push(`${r.request().method()} ${u.pathname}${u.search} ${r.status()}`) })
  await lpage.goto(`${BASE}/schools/support`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await lpage.waitForTimeout(8000)
  const lb = lpage.getByRole('button', { name: 'Later', exact: true }); if (await lb.count()) await lb.first().click().catch(() => {})
  check('support thread endpoint answered 200 for the school admin', lcalls.some((l) => /GET \/api\/support\/thread\S* 200/.test(l)), lcalls.join(' | '))
  check('support composer visible for the school admin', await lpage.locator('textarea').first().isVisible().catch(() => false))
  await lpage.screenshot({ path: `${OUT}/758-2-support.png`, fullPage: true })
  await lctx.close()
}

// 4. One class Insights page loads.
const before = api.length
await page.goto(`${BASE}/org/${CLASS_ID}/insights`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(10000); await dismissLater()
const insightCalls = api.slice(before)
const bodyIns = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
check('class Insights page stayed on its route', page.url().includes(`/org/${CLASS_ID}/insights`), page.url())
check('class Insights page has Insights content', /insight|minute/i.test(bodyIns), bodyIns.slice(0, 300))
check('class home and rate-compare answered 200 for the teacher', insightCalls.some((l) => /\/home 200$/.test(l)) && insightCalls.some((l) => /rate-compare 200$/.test(l)), insightCalls.filter((l) => /groups|org\//.test(l)).join(' | '))
check('no 5xx from the insights page APIs', !insightCalls.some((l) => / 5\d\d$/.test(l)), insightCalls.filter((l) => / 5\d\d$/.test(l)).join(' | '))
await page.screenshot({ path: `${OUT}/758-3-class-insights.png`, fullPage: true })

check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300))
await browser.close()
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASS'}`)
process.exit(failures ? 1 : 0)
