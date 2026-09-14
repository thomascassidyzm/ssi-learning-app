// Job #699: read-only after-probe of the playing-as-yourself strip on the
// served staging build. Bethan ZZ Cover (teacher, ZZ Test Chepstow), a real
// minted session, ~5 s of play in the main player and in Listening Mode at
// 390px. Asserts the strip's bottom edge sits above the top edge of the first
// player control in both modes. Shape follows e2e/_698-693-after-probe.mjs.
import { chromium } from '@playwright/test'
import fs from 'fs'; import path from 'path'
const BASE = (process.env.BASE || 'https://staging.saysomethingin.app').replace(/\/$/, '')
const SHOTS = process.env.SHOTS; fs.mkdirSync(SHOTS, { recursive: true })
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim()
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const TEACHER_EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com' // Bethan ZZ Cover, teacher
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
const session = await mint(TEACHER_EMAIL)
const learnerIds = (await sb(`learners?user_id=eq.${session.user.id}&select=id`)).map(r => r.id)
console.log('learnerIds', JSON.stringify(learnerIds))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const net = []; const logs = []; const ts = () => new Date().toISOString().slice(11, 23)
const out = { version, START }
const BANNER = '[data-walk="player-playing-as-yourself"]'
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v, rk, rv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); localStorage.setItem(rk, rv); localStorage.setItem('ssi-mode-listening', 'true') } catch {} },
  [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-user-role', JSON.stringify({ platformRole: null, educationalRole: 'teacher' })])
const page = await ctx.newPage()
page.on('request', (r) => { const u = r.url(); if (u.includes('/api/') || u.includes('/rest/v1/')) net.push(`${ts()} ${r.method()} ${u.replace(BASE, '').replace(SUPABASE_URL, 'SB').slice(0, 160)}`) })
page.on('console', (m) => { if (m.type() === 'error') logs.push(`${ts()} error: ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => logs.push(`${ts()} pageerror: ${String(e.message).slice(0, 200)}`))
const box = async (sel) => { const l = page.locator(sel).first(); if (!(await l.count())) return null; const b = await l.boundingBox().catch(() => null); return b ? { sel, top: +b.y.toFixed(1), bottom: +(b.y + b.height).toFixed(1), left: +b.x.toFixed(1), height: +b.height.toFixed(1), visible: await l.isVisible() } : { sel, nobox: true } }
const bannerState = async () => ({ ...(await box(BANNER) || { count: 0 }), text: await page.locator(BANNER).first().innerText().catch(() => null), cssVar: await page.evaluate(() => ({ own: document.documentElement.style.getPropertyValue('--own-play-banner-h'), cls: document.documentElement.className, bodyPad: getComputedStyle(document.body).paddingTop })) })
const audioState = () => page.evaluate(() => Array.from(document.querySelectorAll('audio')).map(a => ({ paused: a.paused, t: +a.currentTime.toFixed(2) })))
// Overlap test: banner bottom must be <= the top of every named control that is visible.
async function overlapCheck(label, controlSels) {
  const banner = await box(BANNER)
  const controls = (await Promise.all(controlSels.map(box))).filter(Boolean)
  const visible = controls.filter(c => c.visible && !c.nobox)
  const first = visible.reduce((a, c) => (!a || c.top < a.top ? c : a), null)
  const overlaps = visible.filter(c => banner && c.top < banner.bottom)
  const res = { label, banner, firstControl: first, controls: visible, overlaps, pass: !!banner && banner.visible && visible.length > 0 && overlaps.length === 0 }
  out[label] = res
  console.log(label, res.pass ? 'PASS' : 'FAIL', JSON.stringify({ bannerBottom: banner?.bottom, firstControlTop: first?.top, overlaps: overlaps.map(o => o.sel) }))
  return res
}
async function pressPlay() {
  const btn = page.locator('.center-btn').first()
  await btn.waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForFunction(() => { const b = document.querySelector('.center-btn'); return b && b.getAttribute('aria-busy') !== 'true' }, null, { timeout: 30000 }).catch(() => {})
  await btn.evaluate((el) => el.click())
}
async function openListening() {
  await page.locator('.mode-trigger').first().evaluate((el) => el.click()); await page.waitForTimeout(600)
  const row = page.locator('.mode-tray .tray-item', { hasText: /listen/i }).first()
  if (!(await row.count())) return false
  await row.evaluate((el) => el.click()); await page.waitForTimeout(3000)
  return true
}

// ---- 1. Bethan cold open → My player → play 5 s
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page, 6000)
out.s1_coldOpenUrl = page.url()
if (/\/schools/.test(page.url())) {
  await page.locator('.user-trigger').first().evaluate((el) => el.click()).catch(e => logs.push('avatar: ' + e.message)); await page.waitForTimeout(800)
  await page.locator('.user-menu-pop a.menu-item', { hasText: 'My player' }).evaluate((el) => el.click()).catch(e => logs.push('myplayer: ' + e.message))
  await settle(page, 8000)
}
out.s1_playerUrl = page.url()
out.s1_bannerBeforePlay = await bannerState()
out.s1_headerBeforePlay = await box('.header')
await pressPlay()
await page.waitForTimeout(5000)
out.s1_bannerDuringPlay = await bannerState()
out.s1_audioDuringPlay = await audioState()
await page.screenshot({ path: path.join(SHOTS, '1-main-player-playing-390.png') })
await overlapCheck('s1_mainPlayerOverlap', ['.header', '.belt-row', '.belt-header-skip--back', '.belt-timer-unified', '.belt-header-skip--forward', '.brand', '.app-escape', '.qa-report-btn'])
await pressPlay() // pause
await page.waitForTimeout(1500)
out.s1_bannerAfterPause = await bannerState()
// ---- 2. Listening Mode
out.s2_listeningOpened = await openListening()
if (await page.locator('.transport-btn').count()) {
  await page.locator('.transport-btn').first().evaluate((el) => el.click())
  await page.waitForTimeout(5000)
  out.s2_bannerDuringListening = await bannerState()
  out.s2_audioDuringListening = await audioState()
  await page.screenshot({ path: path.join(SHOTS, '2-listening-mode-playing-390.png') })
  await overlapCheck('s2_listeningOverlap', ['.listening-overlay', '.close-btn', '.back-fab', '.view-tabs', '.speed-row', '.transport-btn', '.playback-hint'])
  await page.locator('.transport-btn').first().evaluate((el) => el.click()) // stop
  await page.waitForTimeout(1500)
  out.s2_bannerAfterStop = await bannerState()
} else {
  await page.screenshot({ path: path.join(SHOTS, '2x-listening-not-opened.png') })
}
await ctx.close(); await browser.close()
await new Promise(r => setTimeout(r, 5000))
out.db_player_events = learnerIds.length ? await sb(`player_events?user_id=in.(${learnerIds.join(',')})&occurred_at=gte.${START}&select=id,event_type,occurred_at`) : []
out.db_sessions = learnerIds.length ? await sb(`sessions?learner_id=in.(${learnerIds.join(',')})&created_at=gte.${START}&select=id`).catch(() => 'n/a') : []
out.END = new Date().toISOString()
fs.writeFileSync(path.join(SHOTS, 'out.json'), JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(SHOTS, 'net.log'), net.join('\n') + '\n'); fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n') + '\n')
console.log(JSON.stringify({ s1: out.s1_mainPlayerOverlap?.pass, s2: out.s2_listeningOverlap?.pass, bannerDuringPlay: out.s1_bannerDuringPlay, bannerDuringListening: out.s2_bannerDuringListening, afterPause: out.s1_bannerAfterPause?.cssVar, events: out.db_player_events?.length, sessions: out.db_sessions }, null, 1))
console.log('NET writes:\n' + net.filter(l => / (POST|PATCH|PUT|DELETE) /.test(l)).join('\n'))
console.log('LOGS\n' + logs.join('\n'))
