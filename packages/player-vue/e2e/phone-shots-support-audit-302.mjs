/**
 * Phone-viewport audit of every place in-app support, Help, How this works
 * and the Handbook appear for a school leader on a deployed build, under
 * View-as — job #302, 2026-09-12. Signs in as the internal admin (minted
 * without mail, as phone-shots-explainer-door-286.mjs does), enters View-as
 * through the real picker, then on every page a school leader can reach
 * shoots: the page as landed, the user menu open, the How-this-works panel
 * open where it mounts, a HandbookMark "?" opened where one exists, and the
 * "Does this look wrong?" sheet opened where one exists. Never sends a
 * support message: the sheet is closed with "Not now". READ-ONLY.
 *
 * Usage:
 *   set -a; . ~/.ssi-sentinel.env; . packages/player-vue/.env.local; set +a
 *   TMPDIR=/tmp LD_LIBRARY_PATH=... CHROME_BIN=... BASE=https://staging.saysomethingin.app \
 *   VIEW_AS=angharadjones SCHOOL=<school-id> CLASS=<class-id> LABEL=angharad \
 *   SHOTS=$CS_SCRATCH/shots node packages/player-vue/e2e/phone-shots-support-audit-302.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const LABEL = process.env.LABEL || 'shot'
const SHOTS = process.env.SHOTS || path.join(process.env.CS_SCRATCH || '/tmp', 'shots-302')
const VIEW_AS = process.env.VIEW_AS || 'angharadjones'
const SCHOOL = process.env.SCHOOL || '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255'
const CLASS = process.env.CLASS || '01041bae-ef81-4c78-bc21-b1a8f0def808'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
fs.mkdirSync(SHOTS, { recursive: true })

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const glj = await gl.json()
  if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${email}: ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }),
  })
  const vj = await v.json()
  if (!v.ok || !vj.access_token) throw new Error(`verify ${email}: ${v.status} ${JSON.stringify(vj).slice(0, 200)}`)
  return vj
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
}

async function shootFull(page, file) {
  const tall = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)).catch(() => 844)
  await page.setViewportSize({ width: 390, height: Math.min(Math.max(844, tall + 40), 9000) })
  await page.waitForTimeout(500)
  await page.screenshot({ path: file, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
}

const manifest = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
const session = await mint(ADMIN_EMAIL)
console.log('minted admin', session.user?.id)
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`${r.status()} ${r.url().slice(0, 120)}`) })

let seq = 0
function record(pageKey, label, note, extra = {}) {
  seq += 1
  const file = path.join(SHOTS, `${LABEL}--${String(seq).padStart(2, '0')}-${pageKey}--${label}.png`)
  manifest.push({ seq, pageKey, label, url: page.url(), file, note, errors: errors.splice(0), ...extra })
  console.log(`[${LABEL}] ${pageKey}/${label} -> ${page.url()} ${note}`)
  return file
}

async function count(sel) { return page.locator(sel).count().catch(() => 0) }
async function texts(sel) { return page.locator(sel).allInnerTexts().catch(() => []) }

/** Everything a cold reader could take for a help or support door on the page as landed. */
async function doors() {
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
  return {
    htwToggle: await count('.htw-toggle'),
    htwHandbookLink: await count('.htw-handbook'),
    handbookMarks: await count('.hb-mark'),
    askSupport: await count('.ask-support'),
    menuTrigger: await count('.user-trigger'),
    visibleWords: {
      support: /\bSupport\b/.test(bodyText),
      handbook: /\bHandbook\b/.test(bodyText),
      howThisWorks: /How this works/.test(bodyText),
      help: /\bHelp\b/.test(bodyText),
      doesThisLookWrong: /Does this look wrong/.test(bodyText),
    },
    h1: (await page.locator('h1').first().innerText().catch(() => '')).slice(0, 80),
  }
}

async function auditPage(pageKey, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => errors.push('goto: ' + e.message.slice(0, 80)))
  await settle(page)
  const d = await doors()
  await shootFull(page, record(pageKey, 'landed', `h1="${d.h1}" doors=${JSON.stringify(d)}`, { doors: d }))

  // User menu open
  if (d.menuTrigger) {
    await page.locator('.user-trigger').first().click({ timeout: 10000 }).catch((e) => errors.push('menu: ' + e.message.slice(0, 80)))
    await page.waitForTimeout(500)
    const items = await texts('.user-menu-pop .menu-item')
    await page.screenshot({ path: record(pageKey, 'menu-open', `menu=${JSON.stringify(items)}`, { menu: items }) })
    await page.locator('.user-trigger').first().click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
  }

  // How this works panel
  if (d.htwToggle) {
    await page.locator('.htw-toggle').first().scrollIntoViewIfNeeded().catch(() => {})
    await page.locator('.htw-toggle').first().click({ timeout: 10000 }).catch((e) => errors.push('htw: ' + e.message.slice(0, 80)))
    await page.waitForTimeout(600)
    const clips = await texts('.htw-card [data-walk-offer]')
    const bodyLen = (await page.locator('.htw-body').innerText().catch(() => '')).length
    await page.locator('.htw-card').first().scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(300)
    await page.screenshot({ path: record(pageKey, 'how-this-works-open', `panel chars=${bodyLen} clips=${JSON.stringify(clips)}`, { clips }) })
    await page.locator('.htw-toggle').first().click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
  }

  // HandbookMark "?"
  if (d.handbookMarks) {
    const mark = page.locator('.hb-mark').first()
    await mark.scrollIntoViewIfNeeded().catch(() => {})
    await mark.click({ timeout: 10000 }).catch((e) => errors.push('mark: ' + e.message.slice(0, 80)))
    await page.waitForTimeout(500)
    const title = await page.locator('.hb-mark-pop .hb-mark-title').first().innerText().catch(() => '')
    await page.screenshot({ path: record(pageKey, 'handbook-mark-open', `mark="${title}"`, { mark: title }) })
    await mark.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
  }

  // Support sheet — opened, shot, closed with Not now. Never sent.
  if (d.askSupport) {
    const ask = page.locator('.ask-support').first()
    await ask.scrollIntoViewIfNeeded().catch(() => {})
    await ask.click({ timeout: 10000 }).catch((e) => errors.push('ask: ' + e.message.slice(0, 80)))
    await page.waitForTimeout(600)
    const sheetTitle = await page.locator('.sheet-title').first().innerText().catch(() => '')
    const context = await page.locator('.sheet-context').first().innerText().catch(() => '')
    await page.screenshot({ path: record(pageKey, 'support-sheet-open', `sheet="${sheetTitle}" context="${context.replace(/\s+/g, ' ').slice(0, 120)}"`, { sheet: sheetTitle }) })
    await page.locator('.sheet-actions .btn-ghost').first().click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
  }
}

try {
  await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  await page.getByTestId('view-as-open').click({ timeout: 20000 })
  await page.getByTestId('view-as-search').fill(VIEW_AS)
  await page.locator('.vap-menu .vap-item').filter({ hasText: new RegExp(VIEW_AS, 'i') }).first().click({ timeout: 20000 })
  await page.waitForURL(/\/schools|\/org/, { timeout: 30000 })
  await settle(page)
  console.log('view-as landed on', page.url())
  const landing = page.url()
  const d0 = await doors()
  await shootFull(page, record('view-as-landing', 'landed', `landing=${landing} doors=${JSON.stringify(d0)}`, { doors: d0 }))

  const pages = [
    ['org-school', `${BASE}/org/${SCHOOL}`],
    ['org-class', `${BASE}/org/${CLASS}`],
    ['org-school-insights', `${BASE}/org/${SCHOOL}/insights`],
    ['org-school-handbook', `${BASE}/org/${SCHOOL}/handbook`],
    ['schools-dashboard', `${BASE}/schools`],
    ['schools-classes', `${BASE}/schools/classes`],
    ['schools-class', `${BASE}/schools/classes/${CLASS}`],
    ['schools-teachers', `${BASE}/schools/teachers`],
    ['schools-students', `${BASE}/schools/students`],
    ['schools-analytics', `${BASE}/schools/analytics`],
    ['schools-settings', `${BASE}/schools/settings`],
    ['schools-handbook', `${BASE}/schools/handbook`],
    ['schools-support', `${BASE}/schools/support`],
    ['intel', `${BASE}/intel`],
  ]
  for (const [key, url] of pages) {
    try { await auditPage(key, url) } catch (e) { errors.push(`${key}: ${String(e.message).slice(0, 120)}`); record(key, 'failed', String(e.message).slice(0, 160)) }
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(SHOTS, `manifest-${LABEL}.json`), JSON.stringify(manifest, null, 2))
console.log('wrote', path.join(SHOTS, `manifest-${LABEL}.json`))
