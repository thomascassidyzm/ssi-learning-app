/**
 * Job #112 — the class brain's full-screen overlay MUST LEAVE.
 *
 * Tom got stuck in it on a real phone, 2026-09-17. This signs in as the REAL
 * ZZ Test Chepstow teacher (never View As), at phone width with touch
 * emulation, opens the Course journey card's full screen, screenshots it with
 * the Close visible, then leaves it by the back gesture and by Close.
 */
import pw from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.js'
const { chromium } = pw
import { readFileSync } from 'node:fs'

const kv = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]))
const env = kv('/home/tomcassidy/SSi/ssi-learning-app/.env.local')
const SUPA = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY
const SVC = kv('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env').SUPABASE_SERVICE_KEY
const ref = new URL(SUPA).hostname.split('.')[0]

async function session(email) {
  const gl = await fetch(`${SUPA}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }) })
  const j = await gl.json()
  if (!j.email_otp) throw new Error('no otp: ' + JSON.stringify(j).slice(0, 300))
  const v = await fetch(`${SUPA}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email, token: j.email_otp }) })
  const s = await v.json()
  if (!s.access_token) throw new Error('no token: ' + JSON.stringify(s).slice(0, 300))
  return s
}

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const CLASS = 'ea59ef42-ab29-46d0-a956-a4fdbe5e1d09'
const OUT = process.env.CS_SCRATCH || '/tmp'
const browser = await chromium.launch({ executablePath: process.env.CHROME })
const s = await session('thomas.cassidy+chepstowtest-cover@gmail.com')
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, val]) => { localStorage.setItem(k, val) }, [`sb-${ref}-auth-token`, JSON.stringify(s)])
const page = await ctx.newPage()
const log = {}

await page.goto(`${BASE}/org/${CLASS}`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {})
await page.waitForSelector('.cb-stats', { timeout: 60000 })
log.tiles = await page.$$eval('.cb-stat', els => els.map(e => e.innerText.replace(/\n/g, ' · ')))
log.arcStroke = await page.$eval('.cb path', e => getComputedStyle(e).stroke).catch(() => null)
log.litDotFill = await page.$$eval('.cb circle', els => {
  const f = els.map(e => getComputedStyle(e).fill)
  return [...new Set(f)]
}).catch(() => null)
log.heardAnywhere = (await page.evaluate(() => document.body.innerText)).toLowerCase().includes('heard')
await page.screenshot({ path: `${OUT}/job112-card.png` })

// open full screen
await page.click('button[aria-label="Open full screen"]')
await page.waitForSelector('.cb-full', { timeout: 10000 })
await page.waitForTimeout(800)
const close = await page.$('.cb-close')
log.closeText = close ? (await close.innerText()).trim() : null
log.closeBox = close ? await close.boundingBox() : null
log.scrimBox = await page.$('.cb-scrim').then(e => e && e.boundingBox())
await page.screenshot({ path: `${OUT}/job112-overlay.png` })

// 1. the back gesture
await page.goBack({ waitUntil: 'commit' }).catch(() => {})
await page.waitForTimeout(900)
log.afterBack = { overlay: !!(await page.$('.cb-full')), url: page.url(), bodyOverflow: await page.evaluate(() => document.body.style.overflow) }

// 2. Close, and 3. the scrim
for (const [name, sel] of [['close', '.cb-close'], ['scrim', '.cb-scrim']]) {
  await page.click('button[aria-label="Open full screen"]')
  await page.waitForSelector('.cb-full', { timeout: 10000 })
  await page.tap(sel)
  await page.waitForTimeout(700)
  log[`after_${name}`] = { overlay: !!(await page.$('.cb-full')), url: page.url() }
}

console.log(JSON.stringify(log, null, 2))
await browser.close()
