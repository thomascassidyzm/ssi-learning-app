/**
 * Phone-viewport shots of the explainer door on a deployed build, as the
 * Chepstow school leader under View-as — job #286, 2026-09-11. Signs in as
 * the internal admin (minted without mail, as phone-shots-view-as-265.mjs
 * does), enters View-as Angharad through the real picker, then on class 8H:
 *   org lens  /org/<8H>              — the page, then Handbook tapped, then How this works tapped
 *   schools   /schools/classes/<8H>  — the page, then How this works tapped where it exists
 * LABEL=before|after names the files. READ-ONLY.
 *
 * Usage:
 *   set -a; . ~/.ssi-sentinel.env; . packages/player-vue/.env.local; set +a
 *   CHROME_BIN=... BASE=https://staging.saysomethingin.app LABEL=before \
 *   SHOTS=$CS_SCRATCH/shots node packages/player-vue/e2e/phone-shots-explainer-door-286.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const LABEL = process.env.LABEL || 'shot'
const SHOTS = process.env.SHOTS || path.join(process.env.CS_SCRATCH || '/tmp', 'shots-286')
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const CLASS_8H = '01041bae-ef81-4c78-bc21-b1a8f0def808'
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
  await page.waitForTimeout(2500)
}

async function shoot(page, file) {
  const tall = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)).catch(() => 844)
  await page.setViewportSize({ width: 390, height: Math.min(Math.max(844, tall + 40), 9000) })
  await page.waitForTimeout(600)
  await page.screenshot({ path: file, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
}

const manifest = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined })
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

function record(label, note) {
  const file = path.join(SHOTS, `${LABEL}--${label}.png`)
  manifest.push({ label, url: page.url(), file, note, errors: errors.splice(0) })
  console.log(`[${LABEL}] ${label} -> ${page.url()} ${note}`)
  return file
}

try {
  await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  await page.getByTestId('view-as-open').click({ timeout: 20000 })
  await page.getByTestId('view-as-search').fill('Angharad')
  await page.locator('.vap-menu .vap-item').filter({ hasText: /angharadjones/i }).first().click({ timeout: 20000 })
  await page.waitForURL(/\/schools|\/org/, { timeout: 30000 })
  await settle(page)
  console.log('view-as landed on', page.url())

  // ORG LENS class node — where View-as put Tom tonight.
  await page.goto(`${BASE}/org/${CLASS_8H}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  const doors = await page.locator('.htw-doors').first()
  const doorsText = await doors.innerText().catch(() => '(no .htw-doors)')
  await doors.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: record('org-8h-doors', `doors: ${doorsText.replace(/\s+/g, ' ')}`) })
  // Handbook tapped
  await page.locator('.htw-handbook').first().click({ timeout: 10000 }).catch((e) => errors.push('handbook click: ' + e.message.slice(0, 80)))
  await settle(page)
  await page.screenshot({ path: record('org-8h-handbook-tapped', (await page.locator('h1').first().innerText().catch(() => '')).slice(0, 80)) })
  // back, How this works tapped
  await page.goto(`${BASE}/org/${CLASS_8H}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  await page.locator('.htw-toggle').first().click({ timeout: 10000 }).catch((e) => errors.push('toggle click: ' + e.message.slice(0, 80)))
  await page.waitForTimeout(600)
  const clips = await page.locator('.htw-card [data-walk-offer]').allTextContents().catch(() => [])
  const bodyLen = (await page.locator('.htw-body').innerText().catch(() => '')).length
  await page.locator('.htw-card').first().scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(400)
  await page.screenshot({ path: record('org-8h-how-this-works-open', `panel chars=${bodyLen} clips=${JSON.stringify(clips)}`) })

  // /schools class page
  await page.goto(`${BASE}/schools/classes/${CLASS_8H}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  const hasDoor = await page.locator('.htw-toggle').count()
  const offers = await page.locator('[data-walk-offer]').allTextContents().catch(() => [])
  await shoot(page, record('schools-8h-page', `door=${hasDoor} offers=${JSON.stringify(offers)}`))
  if (hasDoor) {
    await page.locator('.htw-toggle').first().click({ timeout: 10000 })
    await page.waitForTimeout(600)
    const clips2 = await page.locator('.htw-card [data-walk-offer]').allTextContents().catch(() => [])
    const bodyLen2 = (await page.locator('.htw-body').innerText().catch(() => '')).length
    await page.screenshot({ path: record('schools-8h-how-this-works-open', `panel chars=${bodyLen2} clips=${JSON.stringify(clips2)}`) })
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(SHOTS, `manifest-${LABEL}.json`), JSON.stringify(manifest, null, 2))
console.log('wrote', path.join(SHOTS, `manifest-${LABEL}.json`))
