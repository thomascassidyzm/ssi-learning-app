/**
 * Phone-viewport screenshots of the school pages UNDER VIEW-AS on a deployed
 * build — job #265, 2026-09-11. Signs in as the internal admin (minted without
 * mail, as phone-shots-staging-admin.mjs does), then drives the REAL View-as
 * picker in the admin top bar:
 *   lane "role"     — taps the "School leader" role button, which now lands on
 *                     the most recently active real school leader;
 *   lane "angharad" — searches "Angharad" and picks her, Chepstow's leader.
 * Each lane shoots /schools, /schools/classes and /schools/students at
 * 390x844 @2x, full page, failures included. Manifest beside the PNGs.
 *
 * Usage:
 *   set -a; . ~/.ssi-sentinel.env; . packages/player-vue/.env.local; set +a
 *   LD_LIBRARY_PATH=... CHROME_BIN=... BASE=https://staging.saysomethingin.app \
 *   SHOTS=$CS_SCRATCH/shots node packages/player-vue/e2e/phone-shots-view-as-265.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || path.join(process.env.CS_SCRATCH || '/tmp', 'shots-265')
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
fs.mkdirSync(SHOTS, { recursive: true })

// Chepstow's 8H (played this week) and 11E (never played) — the class page must
// read the class account and say "Not started" in words where it never played.
const PAGES = [['schools-home', '/schools'], ['schools-classes', '/schools/classes'], ['schools-students', '/schools/students'], ['class-8h', '/schools/classes/01041bae-ef81-4c78-bc21-b1a8f0def808'], ['class-11e-never-played', '/schools/classes/fc55b08b-95d6-4aa5-a964-12f5713e76e1']]

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
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

async function shoot(page, file) {
  const tall = await page.evaluate(() => {
    let h = document.documentElement.scrollHeight
    for (const el of document.querySelectorAll('*')) {
      const o = getComputedStyle(el).overflowY
      if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) h = Math.max(h, el.scrollHeight + el.getBoundingClientRect().top)
    }
    return Math.ceil(h)
  }).catch(() => 844)
  await page.setViewportSize({ width: 390, height: Math.min(Math.max(844, tall + 40), 9000) })
  await page.waitForTimeout(800)
  await page.screenshot({ path: file, fullPage: true })
}

const manifest = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined })
const session = await mint(ADMIN_EMAIL)
console.log('minted admin', session.user?.id)

async function lane(key, enterViewAs) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`${r.status()} ${r.url().slice(0, 120)}`) })
  let note = ''
  try {
    await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await settle(page)
    await page.getByTestId('view-as-open').click({ timeout: 20000 })
    await enterViewAs(page)
    await page.waitForURL(/\/schools/, { timeout: 30000 })
    await settle(page)
  } catch (e) { note += `entering view-as failed: ${e.message.slice(0, 160)}. ` }
  const viewingAs = await page.evaluate(() => { try { return sessionStorage.getItem('ssi-viewing-as') } catch { return null } })
  console.log(`[${key}] viewing-as = ${viewingAs}`)
  await shoot(page, path.join(SHOTS, `${key}--00-entered.png`)).catch(() => {})
  for (const [label, p] of PAGES) {
    errors.length = 0
    const url = `${BASE}${p}`
    let pnote = note
    await page.setViewportSize({ width: 390, height: 844 })
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page) } catch (e) { pnote += `navigation error: ${e.message.slice(0, 120)}. ` }
    const landed = page.url()
    const bodyText = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).trim()
    if (landed.replace(/\/$/, '') !== url.replace(/\/$/, '')) pnote += `redirected to ${landed}. `
    if (bodyText.length < 40) pnote += `page body nearly empty. `
    if (errors.length) pnote += `console errors: ${errors.slice(0, 2).join(' | ')}. `
    const hourish = bodyText.match(/\b\d+(\.\d+)?h\b/g) || []
    const file = path.join(SHOTS, `${key}--${label}.png`)
    await shoot(page, file).catch((e) => { pnote += `screenshot failed: ${e.message.slice(0, 80)}` })
    manifest.push({ lane: key, label, url, landed, file, viewingAs, note: pnote.trim(), hourStrings: hourish, firstWords: bodyText.split(/\s+/).filter(Boolean).slice(0, 30).join(' ') })
    console.log(`[${key}] ${label} -> ${landed} ${pnote} hours-like: ${JSON.stringify(hourish)}`)
  }
  await ctx.close()
}

try {
  await lane('role', async (page) => {
    await page.getByTestId('view-as-role-school_admin').click({ timeout: 20000 })
  })
  await lane('angharad', async (page) => {
    await page.getByTestId('view-as-search').fill('Angharad')
    await page.locator('.vap-menu .vap-item').filter({ hasText: /angharadjones/i }).first().click({ timeout: 20000 })
  })
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(SHOTS, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('wrote', path.join(SHOTS, 'manifest.json'))
