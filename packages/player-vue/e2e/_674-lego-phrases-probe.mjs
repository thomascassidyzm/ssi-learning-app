// Job #674: staging probe, read-only, phone width, as ssi_admin viewing-as the
// Chepstow school admin (angharadjones). Shoots class 7H's Insights page (the
// Where-you-are card, the rate caption and the figure caption) and its
// Overview page. Run BEFORE the promotion and AFTER with SHOTS pointing at a
// different directory each time. Nothing is tapped that writes.
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const LEADER = { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones' }
const CLASS_7H = '54decd0d-aebf-420a-8c2c-b4e27a28ad10'
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}
const settle = async (page, ms = 3000) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }
console.log('BASE', BASE, 'version', await fetch(`${BASE}/version.json`).then(r => r.text()))
const session = await mint(ADMIN_EMAIL)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v, pk, pv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(LEADER)])
const page = await ctx.newPage()
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 200)}`))
const bodyText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
for (const [label, url] of [['insights', `${BASE}/org/${CLASS_7H}/insights`], ['overview', `${BASE}/org/${CLASS_7H}`]]) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 10000)
  console.log(label, 'url:', page.url())
  await page.screenshot({ path: path.join(SHOTS, `7H-${label}.png`), fullPage: true })
  const text = await bodyText()
  console.log(label, 'LEGO hits:', (text.match(/lego/gi) || []).length, '| rail:', await page.locator('.map-rail, [data-walk="node-map-rail"]').first().innerText().catch(() => '(absent)').then(t => t.replace(/\s+/g, ' ').slice(0, 300)))
  console.log(label, 'text:', text.slice(0, 1500))
}
await browser.close()
console.log('LOGS', logs.join('\n'))
