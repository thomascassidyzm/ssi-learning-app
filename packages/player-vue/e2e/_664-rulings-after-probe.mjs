// Job #664: read-only staging probe of the four #662 rulings, adapted from
// _662-viewas-two-figures-probe.mjs. View-as florencecotten (teacher) and
// angharadjones (school admin). Play is never pressed. DB checked after.
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
const version = await fetch(`${BASE}/version.json`).then(r => r.text())
console.log('START', START, 'BASE', BASE, 'version', version)
const session = await mint(ADMIN_EMAIL); const adminUid = session.user?.id
const learnerIds = []
for (const uid of [adminUid, TEACHER.userId, LEADER.userId]) for (const r of await sb(`learners?user_id=eq.${uid}&select=id`)) learnerIds.push(r.id)
const auditBefore = await sb(`class_progress_copy_audit?select=id`).catch(() => [])
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const net = []; const logs = []; const ts = () => new Date().toISOString().slice(11, 23)
const out = {}
// persona: view-as persona (or null); roleCache: localStorage ssi-user-role value (or null)
async function ctxFor(label, persona, roleCache) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([k, v, pk, pv, rk, rv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); if (pv) sessionStorage.setItem(pk, pv); if (rv) localStorage.setItem(rk, rv) } catch {} },
    [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', persona ? JSON.stringify(persona) : '', 'ssi-user-role', roleCache ? JSON.stringify(roleCache) : ''])
  const page = await ctx.newPage()
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') || u.includes('/rest/v1/')) net.push(`${ts()} [${label}] ${r.method()} ${u.replace(BASE, '').replace(SUPABASE_URL, 'SB').slice(0, 160)}`) })
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`${ts()} [${label}] error: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => logs.push(`${ts()} [${label}] pageerror: ${String(e.message).slice(0, 200)}`))
  return { ctx, page }
}
const bodyText = async (page) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')

// ---- Rulings 4 (banner on teacher home), 3 (Learn in avatar menu), 4b (player has no banner) via View-as teacher
{
  const { ctx, page } = await ctxFor('teacher', TEACHER, null)
  await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 8000)
  out.teacherHomeUrl = page.url()
  const banner = page.locator('[data-walk="dash-playing-as-yourself"]')
  out.bannerCount = await banner.count()
  out.bannerText = await banner.innerText().catch(() => '(absent)')
  out.bannerHref = await banner.locator('a').getAttribute('href').catch(() => '(absent)')
  out.bannerBeforeWelcome = await page.evaluate(() => {
    const b = document.querySelector('[data-walk="dash-playing-as-yourself"]'); if (!b) return null
    const all = Array.from(document.querySelectorAll('body *'))
    const wi = all.findIndex(e => e.children.length === 0 && /welcome|croeso|hello|hi,/i.test(e.textContent || ''))
    return { bannerIndex: all.indexOf(b), welcomeIndex: wi, welcomeText: wi >= 0 ? all[wi].textContent.trim().slice(0, 80) : null }
  })
  out.learnBtnCount = await page.locator('.learn-btn').count()
  out.ownPracticeLine = await page.locator('[data-walk="dash-own-practice"]').innerText().catch(() => '(absent)')
  await page.screenshot({ path: path.join(SHOTS, 'a-teacher-home-banner.png'), fullPage: false })
  await page.screenshot({ path: path.join(SHOTS, 'a-teacher-home-full.png'), fullPage: true })
  out.teacherHomeText = (await bodyText(page)).slice(0, 700)
  // avatar menu
  await page.locator('.user-trigger').first().evaluate((el) => el.click()); await page.waitForTimeout(800)
  out.menuItems = await page.locator('.user-menu-pop .menu-item').allInnerTexts()
  out.myPlayerHref = await page.locator('.user-menu-pop a.menu-item', { hasText: 'My player' }).getAttribute('href').catch(() => '(absent)')
  await page.screenshot({ path: path.join(SHOTS, 'c-avatar-menu-open.png'), fullPage: false })
  // in-app tap of My player: should reach the player (not redirected)
  await page.locator('.user-menu-pop a.menu-item', { hasText: 'My player' }).evaluate((el) => el.click()).catch(e => logs.push('myplayer click: ' + e.message))
  await settle(page, 8000)
  out.playerUrl = page.url()
  out.playerBannerCount = await page.locator('.own-play-banner, .playing-as-yourself, .own-play-bar, [class*="own-play"], [class*="playing-as"]').count()
  out.playerText = (await bodyText(page)).slice(0, 600)
  out.playerHasPlayingAsYourselfText = /playing as yourself|Play as class/i.test(await bodyText(page))
  out.playerAudioPlaying = await page.evaluate(() => Array.from(document.querySelectorAll('audio')).some(a => !a.paused))
  await page.screenshot({ path: path.join(SHOTS, 'b-teacher-player-no-banner.png'), fullPage: false })
  await ctx.close()
}
// ---- Ruling 2: cold open at bare / with cached teacher role (no view-as) -> /schools
{
  const { ctx, page } = await ctxFor('r2-teacher-cache', null, { platformRole: null, educationalRole: 'teacher' })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.r2_teacherCache_bareRoot = page.url()
  await page.screenshot({ path: path.join(SHOTS, 'e1-teacher-cache-bare-root.png'), fullPage: false })
  await ctx.close()
}
{
  const { ctx, page } = await ctxFor('r2-teacher-viewas', TEACHER, null)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.r2_teacherViewAs_bareRoot = page.url()
  await page.screenshot({ path: path.join(SHOTS, 'e2-teacher-viewas-bare-root.png'), fullPage: false })
  await ctx.close()
}
{
  const { ctx, page } = await ctxFor('r2-teacher-cache-query', null, { platformRole: null, educationalRole: 'teacher' })
  await page.goto(`${BASE}/?course=cym_s_for_eng`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.r2_teacherCache_withQuery = page.url()
  await page.screenshot({ path: path.join(SHOTS, 'e3-teacher-cache-with-query.png'), fullPage: false })
  await ctx.close()
}
{
  const { ctx, page } = await ctxFor('r2-admin-cache', null, { platformRole: null, educationalRole: 'school_admin' })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.r2_adminCache_bareRoot = page.url()
  await page.screenshot({ path: path.join(SHOTS, 'e4-admin-cache-bare-root.png'), fullPage: false })
  await ctx.close()
}
{
  const { ctx, page } = await ctxFor('r2-admin-viewas', LEADER, null)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.r2_adminViewAs_bareRoot = page.url()
  await page.screenshot({ path: path.join(SHOTS, 'e5-admin-viewas-bare-root.png'), fullPage: false })
  // leader keeps Learn in nav
  await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
  out.leaderLearnBtnCount = await page.locator('.learn-btn').count()
  out.leaderSchoolsUrl = page.url()
  await page.screenshot({ path: path.join(SHOTS, 'f-leader-home-learn-in-nav.png'), fullPage: false })
  await ctx.close()
}
await browser.close()
await new Promise(r => setTimeout(r, 4000))
const pe = await sb(`player_events?user_id=in.(${learnerIds.join(',')})&occurred_at=gte.${START}&select=id,user_id,event_type`)
const auditAfter = await sb(`class_progress_copy_audit?select=id`).catch(() => [])
out.dbPlayerEventsSinceStart = pe
out.copyAudit = { before: auditBefore.length, after: auditAfter.length }
out.version = version; out.START = START; out.END = new Date().toISOString()
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(SHOTS, 'out.json'), JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(SHOTS, 'net.log'), net.join('\n') + '\n'); fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n') + '\n')
console.log('NET lines', net.length, 'writes:', net.filter(l => / (POST|PATCH|PUT|DELETE) /.test(l)).join('\n'))
console.log('LOGS\n' + logs.join('\n'))
