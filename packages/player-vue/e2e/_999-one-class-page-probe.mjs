// Job #999: staging probe AS teacher florencecotten (view-as, read-only), at
// phone width. Proves the collapse: her class row lands on ONE class page,
// which carries the stat tiles AND, under Manage class, the tools that used to
// live behind /schools/classes/:id — and that the old URL redirects to it.
// Writes nothing: Play as class is never tapped.
import { chromium } from '/home/tomcassidy/.cs-worktrees/ssi-learning-app/999-ssi-app-collapse-six-teacher-cla/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const SIGN_IN_EMAIL = process.env.PROBE_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const VIEW_AS = process.env.VIEW_AS !== '0'
const PERSONA = { key: 'user:42666839-f7b5-44fd-aca7-6ebf8cca1b3d', userId: '42666839-f7b5-44fd-aca7-6ebf8cca1b3d', role: 'teacher', name: 'florencecotten' }
const CLASS_ID = '5382a091-a94e-48a3-a706-adc32106b7e8'
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}
const settle = async (page, ms = 4000) => { await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {}); await page.waitForTimeout(ms) }
console.log('version', await fetch(`${BASE}/version.json`).then(r => r.text()))
const session = await mint(SIGN_IN_EMAIL)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v, pk, pv, viewAs]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); if (viewAs) sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA), VIEW_AS])
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { if (m.type() === 'error') logs.push(`error: ${m.text().slice(0, 160)}`) })
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 160)}`))
const count = (sel) => page.locator(sel).count()

// (A) the OLD tools URL must land on the ONE class page
await page.goto(`${BASE}/schools/classes/${CLASS_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 7000)
console.log('A redirect landed on:', page.url())
await page.screenshot({ path: path.join(SHOTS, 'A-redirected-class-page.png'), fullPage: true })

// (B) everything the census called unique, on the one page
const checks = {
  'stat tiles': '[data-walk="node-stats"]',
  'class practice card': '[data-walk="class-practice"]',
  'course journey': '[data-walk="class-journey"]',
  'students on own accounts': '.children-section',
  'Play as class': '[data-walk="class-page-play"]',
  'Manage class verb': '[data-walk="class-page-manage"]',
  'Ways in ledger': '[data-walk="ways-in-ledger"]',
  '— tools: teachers': '[data-walk="class-teachers"]',
  '— tools: co-teacher link': '[data-walk="class-coteacher-link"]',
  '— tools: roster': '[data-walk="class-roster"]',
  '— tools: add students': '[data-walk="class-student-add"]',
  '— tools: rename': '[data-walk="class-rename"]',
  '— tools: delete': '[data-walk="class-delete"]',
  '— tools: join link': '[data-walk="class-join-link"]',
  '— tools: copy-play repair': '[data-walk="class-copy-play-picker"], .copy-play-card, [data-walk="class-copy-play-apply"]',
}
for (const [name, sel] of Object.entries(checks)) console.log(`B ${name}:`, await count(sel))
console.log('B duplicate play buttons (should be 0):', await count('[data-walk="class-play"]'))
console.log('B Manage class href:', await page.locator('[data-walk="class-page-manage"]').getAttribute('href').catch(() => '(absent)'))

// (C) the verb scrolls, it does not navigate
const before = page.url()
await page.locator('[data-walk="class-page-manage"]').click().catch(() => {})
await page.waitForTimeout(1500)
console.log('C url unchanged:', page.url() === before, page.url())
console.log('C manage section in view:', await page.evaluate(() => { const el = document.getElementById('manage-class'); if (!el) return 'absent'; const r = el.getBoundingClientRect(); return `top=${Math.round(r.top)} vh=${window.innerHeight}` }))
await page.screenshot({ path: path.join(SHOTS, 'C-manage-class-section.png'), fullPage: false })

// (D) any horizontal overflow at phone width
console.log('D overflow:', await page.evaluate(() => `scrollW=${document.documentElement.scrollWidth} clientW=${document.documentElement.clientWidth}`))
console.log('console errors:', logs.length ? logs.slice(0, 6) : 'none')
await browser.close()
