/**
 * Admin-to-learner messaging probe (job #821). Drives staging as the ssi_admin
 * and as a test learner at phone width, screenshotting each step.
 *   MODE=before  — the surfaces as they stand (no composer, plain inbox)
 *   MODE=after   — compose to ONE learner, then read and reply as that learner
 * Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * CHROME_BIN, OUT (dir), BASE (default staging).
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const OUT = process.env.OUT || '.'
const MODE = process.env.MODE || 'before'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN = 'thomas.cassidy+ssi@gmail.com'
const LEARNER = process.env.LEARNER || 'thomas.cassidy+colombo-wall@gmail.com'
const LEARNER_SEARCH = process.env.LEARNER_SEARCH || 'colombo-wall'

async function mint(email) {
  const gl = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })).json()
  const vj = await (await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: gl.email_otp }) })).json()
  if (!vj.access_token) throw new Error('mint ' + JSON.stringify(gl).slice(0, 200) + ' / ' + JSON.stringify(vj).slice(0, 200))
  return vj
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
async function ctxFor(email) {
  const session = await mint(email)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
  return ctx
}
async function shot(page, name) { await page.screenshot({ path: `${OUT}/${MODE}-${name}.png`, fullPage: false }); console.log('shot', `${MODE}-${name}`) }
async function settle(page, ms = 2500) { await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms) }

const admin = await ctxFor(ADMIN)
const a = await admin.newPage()
a.on('console', (m) => { if (m.type() === 'error') console.log('admin console error:', m.text().slice(0, 200)) })
await a.goto(`${BASE}/admin/messages`, { waitUntil: 'domcontentloaded' }); await settle(a)
await shot(a, 'admin-messages')
console.log('admin url', a.url())

if (MODE === 'after') {
  await a.locator('.seg-item', { hasText: 'One learner' }).click()
  await a.fill('#msg-person', LEARNER_SEARCH); await a.waitForTimeout(2500)
  await a.locator('.person').first().click()
  await a.fill('#msg-title', process.env.TITLE || 'Pod 1 is live')
  await a.fill('#msg-body', process.env.BODY || 'A first **Pod** is ready for you to listen to.\n\nOpen the Library and tap Pods. Write back here if anything is unclear: https://staging.saysomethingin.app/me')
  await a.waitForTimeout(2500)
  await shot(a, 'admin-composed')
  console.log('audience line:', await a.locator('[data-testid="msg-audience"]').innerText())
  await a.locator('[data-testid="msg-send"]').click(); await a.waitForTimeout(400)
  await shot(a, 'admin-armed')
  await a.locator('[data-testid="msg-send"]').click(); await a.waitForTimeout(4000)
  await shot(a, 'admin-sent')
  console.log('outcome:', await a.locator('.ok, .err').first().innerText().catch(() => '(none)'))
}

const learner = await ctxFor(LEARNER)
const l = await learner.newPage()
l.on('console', (m) => { if (m.type() === 'error') console.log('learner console error:', m.text().slice(0, 200)) })
await l.goto(`${BASE}/me`, { waitUntil: 'domcontentloaded' }); await settle(l)
await shot(l, 'learner-me')
await l.goto(`${BASE}/me/inbox`, { waitUntil: 'domcontentloaded' }); await settle(l)
await shot(l, 'learner-inbox')
if (MODE === 'after') {
  await l.locator('.inbox-msg.is-unread .inbox-msg-head').first().click(); await l.waitForTimeout(2500)
  await shot(l, 'learner-open')
  await l.locator('.inbox-reply-box').first().fill(process.env.REPLY || 'Found it, thank you. Will there be more pods for Spanish?')
  await l.locator('.inbox-reply button[type=submit]').click(); await l.waitForTimeout(3500)
  await shot(l, 'learner-replied')
  console.log('reply note:', await l.locator('.inbox-reply-note').first().innerText().catch(() => '(none)'))
}
await browser.close()
