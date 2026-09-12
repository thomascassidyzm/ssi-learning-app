/**
 * Job #301 probe: drive staging under View-as (ssi_admin → angharadjones,
 * School leader, Chepstow) and record every /api/school/class-practice-7d
 * request the Classes page makes, with its status — to see why the list
 * reads dots. Shoots the classes page and the school page.
 *
 *   set -a; . /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
 *   LD_LIBRARY_PATH=~/.ssi-sentinel-libs CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   SHOTS=$CS_SCRATCH/shots node e2e/_301-viewas-classes-probe.mjs
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || '/tmp/shots'
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
  await page.waitForTimeout(3000)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

const session = await mint(ADMIN_EMAIL)
console.log('minted admin', session.user?.id)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
await ctx.addInitScript(([k, v, pk, pv]) => { try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const net = []
page.on('response', async (r) => {
  const u = r.url()
  if (u.includes('/api/')) {
    let body = ''
    try { body = (await r.text()).slice(0, 300) } catch {}
    net.push({ url: u.replace(BASE, '').slice(0, 200), status: r.status(), body })
  }
})
page.on('requestfailed', (r) => { if (r.url().includes('/api/')) net.push({ url: r.url().replace(BASE, '').slice(0, 200), status: 'FAILED', body: r.failure()?.errorText }) })
const logs = []
page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 200)}`))

for (const [label, p] of [['classes', '/schools/classes'], ['school', '/schools']]) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  const tall = await page.evaluate(() => {
    let h = document.documentElement.scrollHeight
    for (const el of document.querySelectorAll('*')) { const o = getComputedStyle(el).overflowY; if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) h = Math.max(h, el.scrollHeight + el.getBoundingClientRect().top) }
    return Math.ceil(h)
  }).catch(() => 900)
  await page.setViewportSize({ width: 1280, height: Math.min(Math.max(900, tall + 40), 9000) })
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(SHOTS, `301-viewas-${label}.png`), fullPage: true })
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 700)
  console.log(`[${label}] ${page.url()}\n  ${text}`)
}
console.log('NET', JSON.stringify(net.filter(n => n.url.includes('class-practice') || n.status !== 200), null, 1))
console.log('ALLNET', net.map(n => `${n.status} ${n.url}`).join('\n'))
console.log('LOGS', logs.join('\n'))
await browser.close()
