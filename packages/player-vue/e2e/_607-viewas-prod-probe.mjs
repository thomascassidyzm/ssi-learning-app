// Job #615 (finishing #607): production probe of the view-as fixes on 5f6b77c24.
// Same setup as e2e/_602-viewas-class-row-probe.mjs, plus: open the player under
// view-as, then EXIT view-as on the same page, and watch whether any batch leaves
// for /api/player-events after the exit (the Astra #606 queue-then-exit case).
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'thomas.cassidy+ssi@gmail.com'
const PERSONA = { key: 'user:96105179-6598-4f2b-9281-a1d28270581b', userId: '96105179-6598-4f2b-9281-a1d28270581b', role: 'school_admin', name: 'angharadjones' }
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
const adminL = await sb(`learners?user_id=eq.${adminUid}&select=id,preferences,updated_at`)
const personaL = await sb(`learners?user_id=eq.${PERSONA.userId}&select=id,preferences,updated_at`)
console.log('admin learners', JSON.stringify(adminL.map(r => [r.id, r.preferences?.last_course_code, r.updated_at])))
console.log('persona learners', JSON.stringify(personaL.map(r => [r.id, r.preferences?.last_course_code, r.updated_at])))
const ceRows = async (ids) => ids.length ? sb(`course_enrollments?learner_id=in.(${ids.join(',')})&select=learner_id,course_id,last_completed_lego_id,highest_completed_lego_id,last_practiced_at,updated_at&order=updated_at.desc`) : []
const allIds = [...adminL.map(r => r.id), ...personaL.map(r => r.id)]
const ceBefore = await ceRows(allIds)
console.log('BEFORE course_enrollments (admin+persona):', JSON.stringify(ceBefore))
const peCount = async (ids) => ids.length ? sb(`player_events?user_id=in.(${ids.join(',')})&occurred_at=gte.${START}&select=id,user_id,event_type,occurred_at`) : []
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript(([k, v, pk, pv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); if (!sessionStorage.getItem('ssi-viewas-probe-exited')) sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(PERSONA)])
const page = await ctx.newPage()
const net = []; const logs = []
const ts = () => new Date().toISOString().slice(11, 23)
page.on('request', (r) => { const u = r.url(), m = r.method(); if (m !== 'GET' || u.includes('/api/')) net.push(`${ts()} ${m} ${u.replace(BASE, '').replace(SUPABASE_URL, '<sb>').slice(0, 200)}${m !== 'GET' ? ' :: ' + String(r.postData() || '').slice(0, 160) : ''}`) })
page.on('response', async (r) => { const u = r.url(); if (r.request().method() !== 'GET' && !u.includes('/auth/v1/')) { let b = ''; try { b = (await r.text()).slice(0, 140) } catch {} net.push(`   -> ${r.status()} ${u.replace(BASE, '').replace(SUPABASE_URL, '<sb>').slice(0, 100)} :: ${b}`) } })
page.on('console', (m) => { const t = m.text(); if (/view-as|viewing|player-events|playerlog|telemetry/i.test(t) || m.type() === 'error') logs.push(`${ts()} ${m.type()}: ${t.slice(0, 200)}`) })
page.on('pageerror', (e) => logs.push(`${ts()} pageerror: ${String(e.message).slice(0, 200)}`))
page.on('framenavigated', (f) => { if (f === page.mainFrame()) logs.push(`${ts()} NAV ${f.url()}`) })

// (A) class row opens class detail inside the school view
await page.goto(`${BASE}/schools/classes`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 5000)
console.log('A classes page:', page.url(), '| banner:', await page.locator('[data-testid="view-as-exit"]').count())
await page.screenshot({ path: path.join(SHOTS, 'A1-classes.png') })
const rows = page.locator('tr[data-walk], tr.class-row, tbody tr, [data-walk^="class-row"]')
console.log('A rows:', await rows.count(), '| first:', (await rows.first().innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 120))
const cell = rows.first().locator('td').first(); await ((await cell.count()) ? cell : rows.first()).click()
for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); logs.push(`${ts()} URL+${(i + 1) * 500} ${page.url()}`) }
await settle(page, 2000)
console.log('A after click:', page.url())
await page.screenshot({ path: path.join(SHOTS, 'A2-after-click.png') })
console.log('A body:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300))

// (B) player under view-as, then exit view-as on the same page (queue-then-exit)
const netB0 = net.length
await page.goto(`${BASE}/?course=spa_for_eng`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 4000)
console.log('B player url:', page.url(), '| viewingAs in sessionStorage:', await page.evaluate(() => sessionStorage.getItem('ssi-viewing-as')?.slice(0, 60)))
await page.screenshot({ path: path.join(SHOTS, 'B1-player-viewas.png') })
// start playback: the red play circle sits mid bottom bar at 1280x900 (see B1 shot)
await page.mouse.click(640, 852); console.log('B clicked play at 640,852')
await page.waitForTimeout(3000)
console.log('B playing? body has time:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g,' ').match(/\d:\d\d/)?.[0])
await page.waitForTimeout(20000)
await page.screenshot({ path: path.join(SHOTS, 'B2-player-20s.png') })
const peBeforeExit = net.slice(netB0).filter(l => l.includes('player-events'))
console.log('B player-events requests while viewing-as:', peBeforeExit.length)
const exitBtn = page.locator('[data-testid="view-as-exit"]')
console.log('B exit button count:', await exitBtn.count())
await page.evaluate(() => sessionStorage.setItem('ssi-viewas-probe-exited', '1'))
const netExit = net.length
if (await exitBtn.count()) await exitBtn.first().click(); else console.log('B NO EXIT BUTTON — cannot exercise queue-then-exit via UI')
await page.waitForTimeout(15000)  // 3 flush intervals
console.log('B after exit url:', page.url(), '| viewingAs:', await page.evaluate(() => sessionStorage.getItem('ssi-viewing-as')))
await page.screenshot({ path: path.join(SHOTS, 'B3-after-exit.png') })
const peAfterExit = net.slice(netExit).filter(l => l.includes('player-events'))
console.log('B player-events requests after exit:', peAfterExit.length)
await browser.close()
await new Promise(r => setTimeout(r, 4000))
const pe = await peCount([...adminL.map(r => r.id), ...personaL.map(r => r.id)])
console.log('DB player_events since START for admin+persona learners:', JSON.stringify(pe))
const adminL2 = await sb(`learners?user_id=eq.${adminUid}&select=id,preferences,updated_at`); const personaL2 = await sb(`learners?user_id=eq.${PERSONA.userId}&select=id,preferences,updated_at`)
console.log('AFTER admin', JSON.stringify(adminL2.map(r => [r.id, r.preferences?.last_course_code, r.updated_at])))
console.log('AFTER persona', JSON.stringify(personaL2.map(r => [r.id, r.preferences?.last_course_code, r.updated_at])))
const ceAfter = await ceRows(allIds)
console.log('AFTER course_enrollments (admin+persona):', JSON.stringify(ceAfter))
const key = (r) => `${r.learner_id}|${r.course_id}`
const changed = ceAfter.filter(a => { const b = ceBefore.find(x => key(x) === key(a)); return !b || b.updated_at !== a.updated_at })
console.log('course_enrollments rows changed since BEFORE (job #618 success = []):', JSON.stringify(changed))
console.log('course_enrollments PATCH/POST requests seen (job #618 success = 0):', net.filter(l => /course_enrollments/.test(l) && /^\S+ (PATCH|POST)/.test(l)).length)
console.log('NET\n' + net.join('\n')); console.log('LOGS\n' + logs.join('\n'))
fs.writeFileSync(path.join(SHOTS, 'net.log'), net.join('\n') + '\n')
fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n') + '\n')
fs.writeFileSync(path.join(SHOTS, 'db.json'), JSON.stringify({ START, adminL, personaL, ceBefore, ceAfter, changed, pe, adminL2, personaL2 }, null, 2))
