// Job #662: staging probe, read-only, phone width, AS two view-as personas:
// teacher florencecotten (her teacher home: class-account minutes and the
// pupils' own-account figure, kept apart) and school admin angharadjones (the
// school home with the copy-play sweep card). Play as class is never tapped,
// the course picker is never opened, and the DB is checked after for any row
// written under the admin's or the personas' learners. Run twice: BEFORE the
// promotion and AFTER, with SHOTS pointing at a different directory each time.
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const TEACHER = { key: 'user:42666839-f7b5-44fd-aca7-6ebf8cca1b3d', userId: '42666839-f7b5-44fd-aca7-6ebf8cca1b3d', role: 'teacher', name: 'florencecotten' }
const LEADER = { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones' }
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
const learnerIds = []
for (const uid of [adminUid, TEACHER.userId, LEADER.userId]) for (const r of await sb(`learners?user_id=eq.${uid}&select=id`)) learnerIds.push(r.id)
const auditBefore = await sb(`class_progress_copy_audit?select=id&created_at=gte.${START}`).catch(() => [])
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const net = []; const logs = []; const ts = () => new Date().toISOString().slice(11, 23)
async function persona(p, label, steps) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v, pk, pv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(p)])
  const page = await ctx.newPage()
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) net.push(`${ts()} [${label}] ${r.method()} ${u.replace(BASE, '').slice(0, 200)}${r.method() !== 'GET' ? ' :: ' + String(r.postData() || '').slice(0, 120) : ''}`) })
  page.on('response', async (r) => { const u = r.url(); if (u.includes('/api/school/class-practice-7d') || u.includes('/api/school/copy-teacher-play/')) { let b = ''; try { b = (await r.text()).slice(0, 700) } catch {} net.push(`   -> ${r.status()} ${u.replace(BASE, '').slice(0, 100)} :: ${b}`) } })
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`${ts()} [${label}] error: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => logs.push(`${ts()} [${label}] pageerror: ${String(e.message).slice(0, 200)}`))
  await steps(page)
  await ctx.close()
}
const bodyText = async (page) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
await persona(TEACHER, 'teacher', async (page) => {
  await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  console.log('T url:', page.url(), '| banner:', await page.locator('[data-testid="view-as-exit"]').count())
  await page.screenshot({ path: path.join(SHOTS, 'T1-teacher-home.png'), fullPage: true })
  console.log('T text:', (await bodyText(page)).slice(0, 900))
  console.log('T class-week:', await page.locator('[data-walk="dash-class-week"]').first().innerText().catch(() => '(absent)'))
  console.log('T pupils row:', await page.locator('[data-walk="dash-class-week-pupils"]').first().innerText().catch(() => '(absent)'))
  console.log('T stat line:', await page.locator('[data-walk="dash-teacher-stats"]').innerText().catch(() => '(absent)'))
  console.log('T own-accounts line:', await page.locator('[data-walk="dash-teacher-own-accounts"]').innerText().catch(() => '(absent)'))
  console.log('T own-practice line:', await page.locator('[data-walk="dash-own-practice"]').innerText().catch(() => '(absent)'))
})
await persona(LEADER, 'leader', async (page) => {
  await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 12000)
  console.log('L url:', page.url(), '| banner:', await page.locator('[data-testid="view-as-exit"]').count())
  await page.screenshot({ path: path.join(SHOTS, 'L1-school-home.png'), fullPage: true })
  console.log('L text:', (await bodyText(page)).slice(0, 700))
  const sweep = page.locator('[data-walk="school-copy-play-sweep"]')
  console.log('L sweep card:', await sweep.count())
  if (await sweep.count()) {
    await sweep.scrollIntoViewIfNeeded(); await page.waitForTimeout(500)
    await sweep.screenshot({ path: path.join(SHOTS, 'L2-sweep-card.png') })
    console.log('L sweep rows:', await page.locator('[data-walk="school-copy-play-sweep-copy"]').count())
    console.log('L sweep text:', (await sweep.innerText()).replace(/\s+/g, ' ').slice(0, 1500))
  }
})
await browser.close()
await new Promise(r => setTimeout(r, 3000))
const pe = await sb(`player_events?user_id=in.(${learnerIds.join(',')})&occurred_at=gte.${START}&select=id,user_id,event_type`)
const auditAfter = await sb(`class_progress_copy_audit?select=id&created_at=gte.${START}`).catch(() => [])
console.log('DB player_events since START (success = []):', JSON.stringify(pe))
console.log('DB copy audit rows since START (success = same count):', auditBefore.length, '->', auditAfter.length)
console.log('NET\n' + net.join('\n')); console.log('LOGS\n' + logs.join('\n'))
fs.writeFileSync(path.join(SHOTS, 'net.log'), net.join('\n') + '\n'); fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n') + '\n')
