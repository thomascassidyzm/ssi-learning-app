/**
 * Phone-viewport screenshots of the node insights page on a deployed build,
 * for a real school beside the demo programme — job #267, 2026-09-11.
 *
 * Signs in as the internal admin (minted without mail, as
 * phone-shots-staging-admin.mjs does) and shoots three lanes at 390x844 @2x,
 * full page, failures included:
 *   admin-ime       — /admin/groups/<IME Demo>/analytics, the surface Tom saw
 *                     drawing everything;
 *   admin-chepstow  — /admin/schools/<Ysgol Cas-gwent>/analytics, the same
 *                     surface for the real school;
 *   angharad        — the REAL View-as picker, search "Angharad", then the
 *                     school leader's own /org/<node>/insights, and class 8H's
 *                     home and insights (Tom's 2026-09-11 screenshots).
 * Manifest beside the PNGs.
 *
 * Usage:
 *   set -a; . ~/.ssi-sentinel.env; . packages/player-vue/.env.local; set +a
 *   LD_LIBRARY_PATH=... CHROME_BIN=... BASE=https://staging.saysomethingin.app \
 *   SHOTS=$CS_SCRATCH/shots node packages/player-vue/e2e/phone-shots-insights-267.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || path.join(process.env.CS_SCRATCH || '/tmp', 'shots-267')
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const CHEPSTOW_SCHOOL = '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255'
const CHEPSTOW_NODE = '568fe0ca-4846-4d4b-ac3d-5af94eb30073'
const IME_NODE = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'
const CLASS_8H = process.env.CLASS_ID || '01041bae-ef81-4c78-bc21-b1a8f0def808'
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
  await page.waitForTimeout(3000)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2000)
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
  await page.setViewportSize({ width: 390, height: Math.min(Math.max(844, tall + 40), 12000) })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: file, fullPage: true })
}

const manifest = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined })
const session = await mint(ADMIN_EMAIL)
console.log('minted admin', session.user?.id)

async function newPage() {
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
  return { ctx, page, errors }
}

async function shotPage(key, label, page, errors, p, note = '') {
  errors.length = 0
  const url = `${BASE}${p}`
  await page.setViewportSize({ width: 390, height: 844 })
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page) } catch (e) { note += `navigation error: ${e.message.slice(0, 120)}. ` }
  const landed = page.url()
  const bodyText = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).trim()
  if (landed.replace(/\/$/, '') !== url.replace(/\/$/, '')) note += `redirected to ${landed}. `
  if (bodyText.length < 40) note += 'page body nearly empty. '
  if (errors.length) note += `console errors: ${errors.slice(0, 3).join(' | ')}. `
  const file = path.join(SHOTS, `${key}--${label}.png`)
  await shoot(page, file).catch((e) => { note += `screenshot failed: ${e.message.slice(0, 80)}` })
  const noPractice = /No practice recorded|not enough data|No other/i.test(bodyText)
  manifest.push({ lane: key, label, url, landed, file, note: note.trim(), noPracticeText: noPractice, firstWords: bodyText.split(/\s+/).filter(Boolean).slice(0, 40).join(' ') })
  console.log(`[${key}] ${label} -> ${landed} ${note} ${noPractice ? '(carries a no-practice sentence)' : ''}`)
}

try {
  {
    const { ctx, page, errors } = await newPage()
    await shotPage('admin-ime', 'insights', page, errors, `/admin/groups/${IME_NODE}/analytics`)
    await shotPage('admin-chepstow', 'insights', page, errors, `/admin/schools/${CHEPSTOW_SCHOOL}/analytics`)
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await newPage()
    let note = ''
    try {
      await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await settle(page)
      await page.getByTestId('view-as-open').click({ timeout: 20000 })
      await page.getByTestId('view-as-search').fill('Angharad')
      await page.locator('.vap-menu .vap-item').filter({ hasText: /angharadjones/i }).first().click({ timeout: 20000 })
      await page.waitForURL(/\/schools/, { timeout: 30000 })
      await settle(page)
    } catch (e) { note += `entering view-as failed: ${e.message.slice(0, 160)}. ` }
    const viewingAs = await page.evaluate(() => { try { return sessionStorage.getItem('ssi-viewing-as') } catch { return null } })
    console.log(`[angharad] viewing-as = ${viewingAs}`)
    await shotPage('angharad', 'schools-home', page, errors, '/schools', note)
    await shotPage('angharad', 'insights', page, errors, `/org/${CHEPSTOW_NODE}/insights`, note)
    await shotPage('angharad', 'class-8h-home', page, errors, `/org/${CLASS_8H}`, note)
    await shotPage('angharad', 'class-8h-insights', page, errors, `/org/${CLASS_8H}/insights?window=7d&measure=minutes_per_class`, note)
    await ctx.close()
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(SHOTS, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('wrote', path.join(SHOTS, 'manifest.json'))
