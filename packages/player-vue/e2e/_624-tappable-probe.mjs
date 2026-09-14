/**
 * Job #624 probe: staging as ssi_admin viewing-as angharadjones (School
 * leader, Chepstow). Taps every stat card and year tile on the school
 * overview, every year tile and the three shown class rows on the classes
 * list, and the old /schools/classes/:id URL; screenshots each destination
 * and prints a tap → destination map. Read-only: view-as writes nothing.
 *
 *   set -a; . /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
 *   LD_LIBRARY_PATH=~/.ssi-sentinel-libs CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   SHOTS=$CS_SCRATCH/shots-624 TMPDIR=/tmp node e2e/_624-tappable-probe.mjs
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || '/tmp/shots-624'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const PERSONA = { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones' }
fs.mkdirSync(SHOTS, { recursive: true })

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json()
  if (!gl.ok || !glj.email_otp) throw new Error(`generate_link: ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json()
  if (!v.ok || !vj.access_token) throw new Error(`verify: ${v.status} ${JSON.stringify(vj).slice(0, 200)}`)
  return vj
}
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
}
const map = []
let n = 0
async function shot(page, label) {
  n += 1
  const file = `624-${String(n).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.png`
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: false })
  return file
}
function text(page) { return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 260)) }
async function record(page, tap, expect) {
  const url = page.url().replace(BASE, '')
  const t = await text(page)
  const file = await shot(page, tap)
  const ok = expect ? expect(url, t) : null
  map.push({ tap, url, ok, file, text: t.slice(0, 160) })
  console.log(`${ok === false ? 'FAIL' : ok === true ? 'ok  ' : '    '} ${tap} → ${url}`)
}
const notRoster = (u, t) => u.startsWith('/org/') && !/Nobody is in this class yet/.test(t) && /CLASS/i.test(t)

const session = await mint(ADMIN_EMAIL)
console.log('minted admin', session.user?.id)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v, pk, pv]) => { try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const writes = []
page.on('request', (r) => { if (r.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(`${r.method()} ${r.url().replace(BASE, '')}`) })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 200)}`))

const v = await (await fetch(`${BASE}/version.json`)).json()
console.log('staging build', JSON.stringify(v))

// 1. School overview via the Dashboard door
await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await settle(page)
await record(page, 'open /schools (school overview)', (u) => u.startsWith('/org/'))
const overviewUrl = page.url()
const cards = await page.$$eval('[data-walk="node-stats"] .stat-card', (els) => els.map((e) => ({ href: e.getAttribute('href'), word: e.querySelector('.stat-word')?.textContent?.trim(), tag: e.tagName })))
console.log('stat cards', JSON.stringify(cards))
for (const c of cards) {
  await page.goto(overviewUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
  const el = await page.$(`[data-walk="node-stats"] a.stat-card[href="${c.href}"]`)
  if (!el) { map.push({ tap: `card: ${c.word}`, url: '(not a link)', ok: false }); console.log(`FAIL card not a link: ${c.word}`); continue }
  await el.click(); await settle(page)
  await record(page, `card: ${c.word}`, (u) => u !== overviewUrl.replace(BASE, ''))
}
// 2. Year tiles on the overview
await page.goto(overviewUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
const tiles = await page.$$eval('[data-walk="node-year-groups"] .year-tile', (els) => els.map((e) => ({ href: e.getAttribute('href'), word: e.querySelector('.year-tile-word')?.textContent?.trim() })))
console.log('overview tiles', JSON.stringify(tiles))
for (const t of tiles) {
  await page.goto(overviewUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
  const el = await page.$(`[data-walk="node-year-groups"] a.year-tile[href="${t.href}"]`)
  if (!el) { map.push({ tap: `overview tile: ${t.word}`, url: '(not a link)', ok: false }); console.log(`FAIL tile not a link: ${t.word}`); continue }
  await el.click(); await settle(page)
  await record(page, `overview tile: ${t.word}`, (u) => u.includes('year='))
}
// 3. Classes list: tiles, subtitle, rows
const classesUrl = `${BASE}/schools/classes`
await page.goto(classesUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
await record(page, 'open /schools/classes', (u) => u.startsWith('/schools/classes'))
const ctiles = await page.$$eval('[data-walk="classes-year-groups"] .year-tile', (els) => els.map((e) => ({ href: e.getAttribute('href'), word: e.querySelector('.year-tile-word')?.textContent?.trim() })))
console.log('classes tiles', JSON.stringify(ctiles))
if (ctiles[0]?.href) {
  await page.click(`[data-walk="classes-year-groups"] a.year-tile[href="${ctiles[0].href}"]`); await settle(page)
  await record(page, `classes tile: ${ctiles[0].word}`, (u, t) => u.includes('year=') && /×/.test(t))
}
await page.goto(classesUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
if (await page.$('.subtitle-link')) { await page.click('.subtitle-link'); await settle(page); await record(page, 'classes headline minutes', (u) => u.includes('sort=hours')) }
await page.goto(classesUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
const rows = await page.$$eval('tr[data-walk="classes-row"]', (els) => els.map((e) => e.querySelector('.cell-name')?.textContent?.trim()))
console.log('class rows shown', JSON.stringify(rows))
for (let i = 0; i < rows.length; i++) {
  await page.goto(classesUrl, { waitUntil: 'domcontentloaded' }); await settle(page)
  const r = (await page.$$('tr[data-walk="classes-row"]'))[i]
  await r.click(); await settle(page)
  await record(page, `class row: ${rows[i]}`, notRoster)
}
// 4. The old URL redirects
const classIds = await page.evaluate(async () => {
  const r = await fetch('/api/school/classes').catch(() => null); return null
}).catch(() => null)
// take a class id from the row we just opened
const lastOrg = map.filter((m) => m.tap.startsWith('class row')).map((m) => m.url).find((u) => u.startsWith('/org/'))
if (lastOrg) {
  const id = lastOrg.split('/')[2].split('?')[0]
  await page.goto(`${BASE}/schools/classes/${id}`, { waitUntil: 'domcontentloaded' }); await settle(page)
  await record(page, `old URL /schools/classes/${id.slice(0, 8)}…`, notRoster)
}
// 5. Teachers card destination sanity is already recorded; also direct /schools/teachers
await page.goto(`${BASE}/schools/teachers`, { waitUntil: 'domcontentloaded' }); await settle(page)
await record(page, 'open /schools/teachers directly', (u) => u.startsWith('/schools/teachers'))

fs.writeFileSync(path.join(SHOTS, 'map.json'), JSON.stringify(map, null, 2))
console.log('WRITES', JSON.stringify(writes))
console.log('LOGS', logs.join('\n'))
console.log('FAILS', map.filter((m) => m.ok === false).length)
await browser.close()
