// Job #651: staging probe AS teacher florencecotten (view-as, read-only) — her
// teacher home, the class page she lands on from her class row, and the class
// tools page, at phone width. Writes nothing: Play as class is never tapped,
// and the DB is checked before/after for the admin's and the persona's rows.
import { chromium } from '/home/tomcassidy/.cs-worktrees/ssi-learning-app/651-ssi-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const PERSONA = { key: 'user:42666839-f7b5-44fd-aca7-6ebf8cca1b3d', userId: '42666839-f7b5-44fd-aca7-6ebf8cca1b3d', role: 'teacher', name: 'florencecotten' }
const CLASS_ID = '5382a091-a94e-48a3-a706-adc32106b7e8'
const sb = (p) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then(r => r.json())
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}
const settle = async (page, ms = 3000) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }
const START = new Date().toISOString()
console.log('START', START, 'BASE', BASE, 'version', await fetch(`${BASE}/version.json`).then(r => r.text()))
const session = await mint(ADMIN_EMAIL); const adminUid = session.user?.id
const adminL = await sb(`learners?user_id=eq.${adminUid}&select=id,updated_at`)
const personaL = await sb(`learners?user_id=eq.${PERSONA.userId}&select=id,updated_at`)
const ids = [...adminL.map(r => r.id), ...personaL.map(r => r.id), 'a7c4d1cf-906f-41b3-89a8-07d2fc89d115']
const ceRows = async () => sb(`course_enrollments?learner_id=in.(${ids.join(',')})&select=learner_id,course_id,last_practiced_at,updated_at`)
const ceBefore = await ceRows()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v, pk, pv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const net = []; const logs = []
const ts = () => new Date().toISOString().slice(11, 23)
page.on('request', (r) => { const u = r.url(), m = r.method(); if (u.includes('/api/')) net.push(`${ts()} ${m} ${u.replace(BASE, '').slice(0, 220)}`) })
page.on('response', async (r) => { const u = r.url(); if (u.includes('/api/school/class-practice-7d') || u.includes('/api/groups/')) { let b = ''; try { b = (await r.text()).slice(0, 600) } catch {} net.push(`   -> ${r.status()} ${u.replace(BASE, '').slice(0, 120)} :: ${b}`) } })
page.on('console', (m) => { if (m.type() === 'error') logs.push(`${ts()} error: ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => logs.push(`${ts()} pageerror: ${String(e.message).slice(0, 200)}`))
page.on('framenavigated', (f) => { if (f === page.mainFrame()) logs.push(`${ts()} NAV ${f.url()}`) })
const bodyText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')

// (A) teacher home
await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
console.log('A url:', page.url(), '| view-as banner:', await page.locator('[data-testid="view-as-exit"]').count())
await page.screenshot({ path: path.join(SHOTS, 'A1-teacher-home.png'), fullPage: true })
const aText = await bodyText(); console.log('A text:', aText.slice(0, 900))
console.log('A own-practice line:', await page.locator('[data-walk="dash-own-practice"]').innerText().catch(() => '(absent)'))
console.log('A stat line:', await page.locator('[data-walk="dash-teacher-stats"]').innerText().catch(() => '(absent)'))

// (B) tap the class → class page
const card = page.locator('[data-walk="dash-class-card"]').first()
console.log('B class cards:', await page.locator('[data-walk="dash-class-card"]').count(), '| first:', (await card.innerText().catch(() => '?')).replace(/\s+/g, ' '))
await card.click(); await settle(page, 6000)
console.log('B url after tap:', page.url())
await page.screenshot({ path: path.join(SHOTS, 'B1-class-page.png'), fullPage: true })
const bText = await bodyText(); console.log('B text:', bText.slice(0, 1200))
console.log('B manage link:', await page.locator('[data-walk="class-page-manage"]').count(), '| play button:', await page.locator('[data-walk="class-page-play"]').count(), '| own-accounts section:', await page.locator('.children-section').count())

// (C) Manage class → tools page
const manage = page.locator('[data-walk="class-page-manage"]').first()
if (await manage.count()) { await manage.click(); await settle(page, 6000) } else { await page.goto(`${BASE}/schools/classes/${CLASS_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000) }
console.log('C url:', page.url())
await page.screenshot({ path: path.join(SHOTS, 'C1-class-tools.png'), fullPage: true })
console.log('C text:', (await bodyText()).slice(0, 700))

// (D) My Classes list
await page.goto(`${BASE}/schools/classes`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
await page.screenshot({ path: path.join(SHOTS, 'D1-my-classes.png'), fullPage: true })
console.log('D text:', (await bodyText()).slice(0, 500))
await browser.close()
await new Promise(r => setTimeout(r, 4000))
const pe = await sb(`player_events?user_id=in.(${ids.join(',')})&occurred_at=gte.${START}&select=id,user_id,event_type`)
const ceAfter = await ceRows()
const key = (r) => `${r.learner_id}|${r.course_id}`
const changed = ceAfter.filter(a => { const b = ceBefore.find(x => key(x) === key(a)); return !b || b.updated_at !== a.updated_at })
console.log('DB player_events since START (success = []):', JSON.stringify(pe))
console.log('DB course_enrollments changed (success = []):', JSON.stringify(changed))
console.log('NET\n' + net.join('\n')); console.log('LOGS\n' + logs.join('\n'))
fs.writeFileSync(path.join(SHOTS, 'net.log'), net.join('\n') + '\n'); fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n') + '\n')
