/**
 * Job #602 probe: under View-as (ssi_admin → angharadjones, School leader,
 * Chepstow) open /schools/classes and CLICK A CLASS ROW. Records the landing
 * URL, every write-shaped request (POST/PATCH/PUT/DELETE, and every /api call),
 * the console, and the saved course of admin + persona before/after — so a
 * "Your course was updated" toast can be tied to a row, or cleared.
 *
 *   set -a; . /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
 *   TMPDIR=/tmp LD_LIBRARY_PATH=~/.pw-libs/usr/lib/x86_64-linux-gnu:~/.ssi-sentinel-libs \
 *   CHROME_BIN=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
 *   SHOTS=$CS_SCRATCH/shots node e2e/_602-viewas-class-row-probe.mjs
 */
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'
import path from 'path'

const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || '/tmp/shots'
const TAG = process.env.TAG || '602'
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
async function learnerRow(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/learners?user_id=eq.${userId}&select=id,user_id,preferences,updated_at`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })
  return r.json()
}
const settle = async (page, ms = 3000) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }

const session = await mint(ADMIN_EMAIL)
const adminUid = session.user?.id
console.log('minted admin', adminUid)
const before = { admin: await learnerRow(adminUid), persona: await learnerRow(PERSONA.userId) }
console.log('BEFORE admin', JSON.stringify(before.admin.map(r => ({ id: r.id, last: r.preferences?.last_course_code, updated_at: r.updated_at }))))
console.log('BEFORE persona', JSON.stringify(before.persona.map(r => ({ id: r.id, last: r.preferences?.last_course_code, updated_at: r.updated_at }))))

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript(([k, v, pk, pv]) => { try { localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const net = []
page.on('request', (r) => {
  const u = r.url(); const m = r.method()
  if (m !== 'GET' || u.includes('/api/')) net.push(`${new Date().toISOString().slice(11, 23)} ${m} ${u.replace(BASE, '').replace(SUPABASE_URL, '<sb>').slice(0, 220)}${m !== 'GET' ? ' :: ' + String(r.postData() || '').slice(0, 200) : ''}`)
})
page.on('response', async (r) => { const u = r.url(); if (r.request().method() !== 'GET' && !u.includes('/auth/v1/')) { let b = ''; try { b = (await r.text()).slice(0, 160) } catch {} net.push(`   -> ${r.status()} ${u.replace(BASE, '').replace(SUPABASE_URL, '<sb>').slice(0, 120)} :: ${b}`) } })
const logs = []
page.on('console', (m) => { const t = m.text(); if (/view-as|router|Router|navigat|redirect|guard|course/i.test(t) || ['warning', 'error'].includes(m.type())) logs.push(`${m.type()}: ${t.slice(0, 240)}`) })
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 200)}`))
page.on('framenavigated', (f) => { if (f === page.mainFrame()) logs.push(`NAV ${new Date().toISOString().slice(11, 23)} ${f.url()}`) })

await page.goto(`${BASE}/schools/classes`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await settle(page, 5000)
console.log('classes page:', page.url())
await page.screenshot({ path: path.join(SHOTS, `${TAG}-1-classes.png`), fullPage: false })
const rows = page.locator('tr[data-walk], tr.class-row, tbody tr, [data-walk^="class-row"]')
console.log('row candidates:', await rows.count())
const row = rows.first()
console.log('first row text:', (await row.innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 160))
// Click the class name cell, not the Copy link / Play buttons.
const cell = row.locator('td').first()
const target = (await cell.count()) ? cell : row
await target.click()
// Watch the URL settle over 8s — record every hop.
for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); logs.push(`URL+${(i + 1) * 500}ms ${page.url()}`) }
await settle(page, 3000)
console.log('after click:', page.url())
await page.screenshot({ path: path.join(SHOTS, `${TAG}-2-after-click.png`), fullPage: false })
const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 500)
console.log('after text:', text)
const toast = await page.evaluate(() => Array.from(document.querySelectorAll('*')).some(e => e.childElementCount === 0 && /course was updated/i.test(e.textContent || '')))
console.log('toast visible:', toast)
const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /course|viewing/i.test(k)).map(k => [k, localStorage.getItem(k)?.slice(0, 120)])))
console.log('localStorage course keys:', JSON.stringify(ls))

const after = { admin: await learnerRow(adminUid), persona: await learnerRow(PERSONA.userId) }
console.log('AFTER admin', JSON.stringify(after.admin.map(r => ({ id: r.id, last: r.preferences?.last_course_code, updated_at: r.updated_at }))))
console.log('AFTER persona', JSON.stringify(after.persona.map(r => ({ id: r.id, last: r.preferences?.last_course_code, updated_at: r.updated_at }))))
console.log('NET\n' + net.join('\n'))
console.log('LOGS\n' + logs.join('\n'))
await browser.close()
