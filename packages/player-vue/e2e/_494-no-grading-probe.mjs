/**
 * Job #494 probe: under View-as (ssi_admin → angharadjones, school_admin,
 * Chepstow) walk Dashboard, Classes, one class, Students and the schools list,
 * shoot each, and assert the DOM carries no grade: none of the four words,
 * no .health-dot, no Health picker or column.
 *
 *   set -a; . /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
 *   LD_LIBRARY_PATH=~/.ssi-sentinel-libs CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   TMPDIR=/tmp/p494 BASE=https://ssi-learning-app-git-dev-zenjin.vercel.app SHOTS=$CS_SCRATCH/shots node e2e/_494-no-grading-probe.mjs
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || '/tmp/shots'
const TAG = process.env.TAG || 'dev'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const PERSONA = { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones', schoolId: '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255' }
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
  await page.waitForTimeout(3000)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

const version = await (await fetch(`${BASE}/version.json?cb=${Date.now()}`)).json().catch(() => null)
console.log('BASE', BASE, 'version', JSON.stringify(version))
const session = await mint(ADMIN_EMAIL)
console.log('minted admin', session.user?.id)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v, pk, pv]) => { try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 200)}`))

const GRADE_WORDS = ['Excellent', 'Needs attention', 'Needs eyes', 'Inactive']
const results = []
async function check(label) {
  const tall = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)).catch(() => 844)
  await page.setViewportSize({ width: 390, height: Math.min(Math.max(844, tall + 40), 9000) })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(SHOTS, `494-${TAG}-${label}.png`), fullPage: true })
  const r = await page.evaluate((words) => {
    const text = document.body.innerText
    const found = words.filter((w) => text.includes(w))
    const dots = document.querySelectorAll('.health-dot').length
    const healthSelects = [...document.querySelectorAll('select')].filter((sel) => [...sel.options].some((o) => o.value === 'needs-attention')).length
    const healthHeaders = [...document.querySelectorAll('th')].filter((th) => /\bHealth\b/.test(th.textContent || '')).length
    return { found, dots, healthSelects, healthHeaders, text: text.replace(/\s+/g, ' ').slice(0, 400) }
  }, GRADE_WORDS)
  const pass = r.found.length === 0 && r.dots === 0 && r.healthSelects === 0 && r.healthHeaders === 0
  results.push({ label, url: page.url(), pass, ...r })
  console.log(`[${label}] ${pass ? 'PASS' : 'FAIL'} ${page.url()} words=${JSON.stringify(r.found)} dots=${r.dots} selects=${r.healthSelects} headers=${r.healthHeaders}\n  ${r.text}`)
}

for (const [label, p] of [['dashboard', '/schools'], ['classes', '/schools/classes'], ['students', '/schools/students'], ['schools-list', '/schools/all']]) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  await check(label)
}
// One class detail. A phone-width tap on the row landed in the player on dev
// (job #495, cause not chased — out of #494's scope), so open the roster by
// its own route with a live class id from the school and REQUIRE that route;
// the tap's destination is logged as an observation only.
await page.goto(`${BASE}/schools/classes`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await settle(page)
const row = page.locator('[data-walk="classes-row"]').first()
if (await row.count()) {
  const navs = []
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()) })
  await row.evaluate((el) => el.click())
  await settle(page)
  console.log('[observation] row tap navigated:', navs.join(' -> ') || '(nowhere)', '| ended at', page.url())
}
const schoolId = PERSONA.schoolId
const cls = await (await fetch(`${SUPABASE_URL}/rest/v1/classes?school_id=eq.${schoolId}&select=id,class_name&order=class_name&limit=1`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json()
if (Array.isArray(cls) && cls[0]?.id) {
  await page.goto(`${BASE}/schools/classes/${cls[0].id}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  if (!/\/schools\/classes\/[^/]+$/.test(page.url())) {
    results.push({ label: 'class-detail', pass: false, found: [], note: `did not stay on class-detail: ${page.url()}` })
    console.log('[class-detail] FAIL did not stay on class-detail', page.url())
  } else {
    await check('class-detail')
  }
} else {
  results.push({ label: 'class-detail', pass: false, found: [], note: 'no class in the school to open' })
  console.log('[class-detail] no class in the school to open')
}
console.log('LOGS', logs.join('\n') || '(none)')
const allPass = results.every((r) => r.pass)
fs.writeFileSync(path.join(SHOTS, `494-${TAG}-assertions.json`), JSON.stringify({ base: BASE, version, results, logs }, null, 2))
console.log(allPass ? 'ALL PASS' : 'SOME FAIL')
await browser.close()
process.exit(allPass ? 0 : 1)
