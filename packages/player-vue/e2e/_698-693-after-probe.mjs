// Job #698: read-only after-probe of job #693 on the served staging build.
// Real minted sessions for Bethan ZZ Cover (teacher, ZZ Test Chepstow) and a
// no-school learner; a few seconds of play in the main player and in
// Listening Mode; the admin View As picker at 1280px. DB checked after for
// player_events written under the probed learners.
import { chromium } from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const TEACHER_EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com' // Bethan ZZ Cover, teacher
const PLAIN_EMAIL = 'thomas.cassidy+cs634probe@gmail.com' // no school role, no tags
const sb = (p) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then(r => r.json())
async function mint(email) {
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })
  const glj = await gl.json(); if (!gl.ok || !glj.email_otp) throw new Error(`generate_link ${gl.status} ${JSON.stringify(glj).slice(0, 200)}`)
  const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: glj.email_otp }) })
  const vj = await v.json(); if (!v.ok || !vj.access_token) throw new Error(`verify ${v.status}`); return vj
}
const settle = async (page, ms = 3000) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }
const START = new Date().toISOString()
const version = await fetch(`${BASE}/version.json`).then(r => r.text())
console.log('START', START, 'BASE', BASE, 'version', version)
const sessions = { admin: await mint(ADMIN_EMAIL), teacher: await mint(TEACHER_EMAIL), plain: await mint(PLAIN_EMAIL) }
const learnerIds = {}
for (const [k, s] of Object.entries(sessions)) learnerIds[k] = (await sb(`learners?user_id=eq.${s.user.id}&select=id`)).map(r => r.id)
console.log('learnerIds', JSON.stringify(learnerIds))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const net = []; const logs = []; const ts = () => new Date().toISOString().slice(11, 23)
const out = {}
const BANNER = '[data-walk="player-playing-as-yourself"]'
async function ctxFor(label, session, { roleCache = null, desktop = false, listening = false } = {}) {
  const ctx = await browser.newContext(desktop
    ? { viewport: { width: 1280, height: 800 } }
    : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v, rk, rv, lk]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); if (rv) localStorage.setItem(rk, rv); if (lk) localStorage.setItem('ssi-mode-listening', 'true') } catch {} },
    [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-user-role', roleCache ? JSON.stringify(roleCache) : '', listening ? '1' : ''])
  const page = await ctx.newPage()
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') || u.includes('/rest/v1/')) net.push(`${ts()} [${label}] ${r.method()} ${u.replace(BASE, '').replace(SUPABASE_URL, 'SB').slice(0, 160)}`) })
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`${ts()} [${label}] error: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => logs.push(`${ts()} [${label}] pageerror: ${String(e.message).slice(0, 200)}`))
  return { ctx, page }
}
const bodyText = async (page) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
const bannerState = async (page) => {
  const b = page.locator(BANNER)
  const n = await b.count()
  if (!n) return { count: 0 }
  const box = await b.boundingBox().catch(() => null)
  return { count: n, text: (await b.innerText()).replace(/\s+/g, ' '), visible: await b.isVisible(), top: box?.y, height: box?.height }
}
const audioState = (page) => page.evaluate(() => Array.from(document.querySelectorAll('audio')).map(a => ({ paused: a.paused, t: a.currentTime, src: (a.currentSrc || a.src || '').slice(-40) })))
async function pressPlay(page) {
  const btn = page.locator('.center-btn').first()
  await btn.waitFor({ state: 'visible', timeout: 20000 })
  // wait until not loading
  await page.waitForFunction(() => { const b = document.querySelector('.center-btn'); return b && b.getAttribute('aria-busy') !== 'true' }, null, { timeout: 30000 }).catch(() => {})
  await btn.evaluate((el) => el.click())
}
async function openListening(page) {
  await page.locator('.mode-trigger').first().evaluate((el) => el.click()); await page.waitForTimeout(600)
  const row = page.locator('.mode-tray .tray-item', { hasText: /listen/i }).first()
  const n = await row.count()
  if (!n) return false
  await row.evaluate((el) => el.click()); await page.waitForTimeout(3000)
  return true
}

// ---- 1. Bethan cold open → /schools → My player → play 5 s → banner
{
  const { ctx, page } = await ctxFor('teacher', sessions.teacher, { roleCache: { platformRole: null, educationalRole: 'teacher' }, listening: true })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.s1_coldOpenUrl = page.url()
  await page.screenshot({ path: path.join(SHOTS, '1a-teacher-cold-open.png') })
  await page.locator('.user-trigger').first().evaluate((el) => el.click()).catch(e => logs.push('avatar: ' + e.message)); await page.waitForTimeout(800)
  out.s1_menuItems = await page.locator('.user-menu-pop .menu-item').allInnerTexts().catch(() => [])
  await page.locator('.user-menu-pop a.menu-item', { hasText: 'My player' }).evaluate((el) => el.click()).catch(e => logs.push('myplayer: ' + e.message))
  await settle(page, 8000)
  out.s1_playerUrl = page.url()
  out.s1_bannerBeforePlay = await bannerState(page)
  await pressPlay(page)
  await page.waitForTimeout(5000)
  out.s1_bannerDuringPlay = await bannerState(page)
  out.s1_audioDuringPlay = await audioState(page)
  await page.screenshot({ path: path.join(SHOTS, '1b-teacher-player-playing.png') })
  out.s1_playerTextDuringPlay = (await bodyText(page)).slice(0, 400)
  await pressPlay(page) // pause
  await page.waitForTimeout(1500)
  out.s1_bannerAfterPause = await bannerState(page)
  await page.screenshot({ path: path.join(SHOTS, '1c-teacher-player-paused.png') })
  // ---- 2. Listening Mode on the same account
  out.s2_listeningOpened = await openListening(page)
  out.s2_overlayCount = await page.locator('.transport-btn').count()
  if (out.s2_overlayCount) {
    await page.locator('.transport-btn').first().evaluate((el) => el.click())
    await page.waitForTimeout(5000)
    out.s2_bannerDuringListening = await bannerState(page)
    out.s2_audioDuringListening = await audioState(page)
    out.s2_listeningHint = await page.locator('.playback-hint').first().getAttribute('class').catch(() => null)
    await page.screenshot({ path: path.join(SHOTS, '2a-teacher-listening-playing.png') })
    out.s2_listeningText = (await bodyText(page)).slice(0, 400)
    await page.locator('.transport-btn').first().evaluate((el) => el.click()) // stop
    await page.waitForTimeout(1500)
    out.s2_bannerAfterStop = await bannerState(page)
  } else {
    await page.screenshot({ path: path.join(SHOTS, '2x-teacher-listening-not-opened.png') })
    out.s2_text = (await bodyText(page)).slice(0, 400)
  }
  await ctx.close()
}
// ---- 3. Plain learner, no school role: banner absent on both surfaces
{
  const { ctx, page } = await ctxFor('plain', sessions.plain, { listening: true })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 8000)
  out.s3_url = page.url()
  await pressPlay(page)
  await page.waitForTimeout(5000)
  out.s3_bannerDuringPlay = await bannerState(page)
  out.s3_audioDuringPlay = await audioState(page)
  await page.screenshot({ path: path.join(SHOTS, '3a-plain-player-playing.png') })
  await pressPlay(page); await page.waitForTimeout(1000)
  out.s3_listeningOpened = await openListening(page)
  if (await page.locator('.transport-btn').count()) {
    await page.locator('.transport-btn').first().evaluate((el) => el.click()); await page.waitForTimeout(5000)
    out.s3_bannerDuringListening = await bannerState(page)
    await page.screenshot({ path: path.join(SHOTS, '3b-plain-listening-playing.png') })
    await page.locator('.transport-btn').first().evaluate((el) => el.click())
  }
  await ctx.close()
}
// ---- 4. Admin View As picker at 1280px
{
  const { ctx, page } = await ctxFor('admin', sessions.admin, { desktop: true })
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.s4_url = page.url()
  await page.locator('[data-testid="view-as-open"]').first().evaluate((el) => el.click()).catch(e => logs.push('viewas open: ' + e.message)); await page.waitForTimeout(800)
  out.s4_roleRows = await page.locator('.vap-menu .vap-item').allInnerTexts().catch(() => [])
  await page.screenshot({ path: path.join(SHOTS, '4a-admin-viewas-menu.png') })
  await page.locator('[data-testid="view-as-search"]').fill('angharad'); await page.waitForTimeout(4000)
  out.s4_results = await page.locator('[data-testid="view-as-result"]').allInnerTexts().catch(() => [])
  await page.screenshot({ path: path.join(SHOTS, '4b-admin-viewas-angharad.png') })
  const menu = page.locator('.vap-menu')
  if (await menu.count()) await menu.screenshot({ path: path.join(SHOTS, '4c-admin-viewas-menu-crop.png') })
  // the API's own figure
  const api = await page.evaluate(async (tok) => { const r = await fetch('/api/admin/users?limit=25&class_minutes_7d=1&search=angharad', { headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, body: (await r.text()).slice(0, 1500) } }, sessions.admin.access_token)
  out.s4_api = api
  await ctx.close()
}
await browser.close()
await new Promise(r => setTimeout(r, 5000))
for (const [k, ids] of Object.entries(learnerIds)) {
  if (!ids.length) continue
  out[`db_player_events_${k}`] = await sb(`player_events?user_id=in.(${ids.join(',')})&occurred_at=gte.${START}&select=id,event_type,occurred_at`)
  out[`db_sessions_${k}`] = await sb(`sessions?learner_id=in.(${ids.join(',')})&created_at=gte.${START}&select=id`).catch(() => 'n/a')
}
out.version = version; out.START = START; out.END = new Date().toISOString()
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(SHOTS, 'out.json'), JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(SHOTS, 'net.log'), net.join('\n') + '\n'); fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n') + '\n')
console.log('NET writes:\n' + net.filter(l => / (POST|PATCH|PUT|DELETE) /.test(l)).join('\n'))
console.log('LOGS\n' + logs.join('\n'))
