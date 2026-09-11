/**
 * Phone-viewport screenshots of the school-admin and internal-admin pages on a
 * deployed build — the "just give me the screenshots" ask (job #259, 2026-09-11).
 *
 * Two logins, minted without mail (admin generate_link → /auth/v1/verify), each
 * carried into the browser by seeding sb-<ref>-auth-token before load. Every
 * page is shot at 390x844 @2x, full page, INCLUDING failures: a redirect, a
 * blank shell or an error banner is a finding, so nothing is skipped. The
 * result is a JSON manifest of {label,url,landed,file,note} beside the PNGs.
 *
 * Usage:
 *   set -a; . ~/.ssi-sentinel.env; . packages/player-vue/.env.local; set +a
 *   LD_LIBRARY_PATH=~/.ssi-sentinel-libs BASE=https://staging.saysomethingin.app \
 *   SHOTS=$CS_SCRATCH/shots node packages/player-vue/e2e/phone-shots-staging-admin.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || '/tmp/shots'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error('need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const CHEPSTOW = process.env.SCHOOL_ID || '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255'
fs.mkdirSync(SHOTS, { recursive: true })

const LANES = [
  { key: 'school-admin', email: process.env.LANE_A_EMAIL || 'thomas.cassidy+chepstowtest-leader@gmail.com', pages: [
    ['front', '/'],
    ['schools-home', '/schools'],
    ['schools-classes', '/schools/classes'],
    ['schools-support', '/schools/support'],
    ['schools-analytics', '/schools/analytics'],
  ] },
  { key: 'internal-admin', email: process.env.LANE_B_EMAIL || 'thomas.cassidy+ssi@gmail.com', pages: [
    ['front', '/'],
    ['admin-school-home', `/admin/schools/${CHEPSTOW}`],
    ['admin-school-classes', `/admin/schools/${CHEPSTOW}/classes`],
    ['intel-where-and-what', '/intel/where-and-what'],
  ] },
]

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
  return { session: vj, actionLink: glj.action_link }
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

const manifest = []
const chromeDir = process.env.CHROME_BIN
const browser = await chromium.launch({ headless: true, executablePath: chromeDir || undefined })
try {
  for (const lane of LANES) {
    let minted
    try { minted = await mint(lane.email) } catch (e) {
      manifest.push({ lane: lane.key, label: 'mint', url: null, landed: null, file: null, note: `session mint FAILED: ${e.message}` })
      console.log('MINT FAIL', lane.key, e.message); continue
    }
    console.log('minted', lane.key, minted.session.user?.id)
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(minted.session)])
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    for (const [label, p] of lane.pages) {
      errors.length = 0
      const url = `${BASE}${p}`
      await page.setViewportSize({ width: 390, height: 844 })
      const file = path.join(SHOTS, `${lane.key}--${label}.png`)
      let note = ''
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await settle(page)
      } catch (e) { note += `navigation error: ${e.message.slice(0, 120)}. ` }
      const landed = page.url()
      const bodyText = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).trim()
      const spinner = await page.evaluate(() => !!document.querySelector('[class*="spinner"],[class*="loading"],[aria-busy="true"]')).catch(() => false)
      if (landed.replace(/\/$/, '') !== url.replace(/\/$/, '')) note += `redirected to ${landed}. `
      if (bodyText.length < 40) note += `page body nearly empty (${bodyText.length} chars). `
      if (spinner) note += 'a loading indicator is still present. '
      if (errors.length) note += `console errors: ${errors.slice(0, 2).join(' | ')}. `
      // The shell scrolls inside its own container, so fullPage alone stops at
      // the fold: grow the viewport to the tallest scroll box, then shoot.
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
      await page.screenshot({ path: file, fullPage: true }).catch(async (e) => { note += `screenshot failed: ${e.message.slice(0, 80)}`; })
      const words = bodyText.split(/\s+/).filter(Boolean).slice(0, 14).join(' ')
      manifest.push({ lane: lane.key, email: lane.email, label, url, landed, file, note: note.trim(), firstWords: words })
      console.log(`[${lane.key}] ${label} -> ${landed} ${note}`)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(SHOTS, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('wrote', path.join(SHOTS, 'manifest.json'))
