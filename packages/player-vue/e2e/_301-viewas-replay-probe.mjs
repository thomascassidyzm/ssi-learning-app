/**
 * Job #301 probe: replay Tom's exact in-app sequence on staging — sign in as
 * ssi_admin, View-as leejames, Exit, View-as angharadjones, open Classes —
 * capturing every class-practice-7d request (url, status) and a screenshot.
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
fs.mkdirSync(SHOTS, { recursive: true })

async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json()
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json()
  if (!vj.access_token) throw new Error('mint failed ' + JSON.stringify(vj).slice(0, 200))
  return vj
}
const settle = async (page, ms = 2500) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }

const session = await mint(process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const page = await ctx.newPage()
const net = []
page.on('response', async (r) => { const u = r.url(); if (u.includes('class-practice-7d') || u.includes('/home') || u.includes('view-as')) { let b = ''; try { b = (await r.text()).slice(0, 160) } catch {} net.push(`${new Date().toISOString().slice(11, 19)} ${r.status()} ${u.replace(BASE, '').replace(/class_ids=[^&]*/, 'class_ids=<N>')} :: ${b}`) } })
page.on('requestfailed', (r) => { if (r.url().includes('/api/')) net.push(`FAILED ${r.url().replace(BASE, '').slice(0, 120)} ${r.failure()?.errorText}`) })
const logs = []
page.on('console', (m) => { if (['warning', 'error'].includes(m.type()) && !m.text().includes('popty')) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 200)}`))

async function viewAs(name) {
  await page.click('[data-testid=view-as-open]')
  await page.fill('[data-testid=view-as-search]', name)
  await page.waitForTimeout(1500)
  const btn = page.locator('[data-testid=view-as-search] ~ button, .vap-result, button:has-text("' + name + '")').first()
  await btn.click()
  await page.waitForURL(/\/schools|\/org\//, { timeout: 20000 }).catch(() => {})
  await settle(page)
  console.log('viewAs', name, '->', page.url())
}
async function classes(label) {
  await page.click('a:has-text("Classes"), button:has-text("Classes")').catch(async () => page.goto(`${BASE}/schools/classes`))
  await settle(page, 4000)
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
  const i = text.indexOf('Classes 3')
  console.log(`[${label}] ${page.url()} :: ${text.slice(Math.max(0, i), Math.max(0, i) + 420)}`)
  await page.screenshot({ path: path.join(SHOTS, `301-replay-${label}.png`), fullPage: false })
}

await page.goto(`${BASE}/admin/structure`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await settle(page)
console.log('admin at', page.url())
await viewAs('leejames')
await classes('leejames')
await page.click('[data-testid=view-as-exit]')
await settle(page)
console.log('after exit', page.url())
await viewAs('angharadjones')
await classes('angharad')
console.log('NET\n' + net.join('\n'))
console.log('LOGS\n' + logs.join('\n'))
await browser.close()
