// Job #675: staging probe, READ-ONLY. Two view-as personas (school admin
// angharadjones, teacher florencecotten) x two widths (390x844 phone,
// 1280x800 desktop) on /schools, as ssi_admin thomas.cassidy+ssi.
//
// What it proves, per persona per width:
//   1. the Viewing-As strip's bounding box does NOT intersect the schools top bar
//   2. the avatar trigger opens its menu, and "My player" is in it
//   3. no a.learn-btn anywhere in the DOM
//   4. (phone) the hamburger opens the mobile nav
//   5. the strip's Pages list opens and renders rows
// Play as class is never tapped, the course picker never opened; player_events
// under the admin's and the personas' learners are checked after the run.
//
// Run BEFORE and AFTER the promotion with SHOTS pointing at different dirs.
import { chromium } from '/home/tomcassidy/.cs-worktrees/ssi-learning-app/675-viewing-as-strip-off-the-nav-lea/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
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
const settle = async (page, ms = 6000) => { await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {}); await page.waitForTimeout(ms) }
const START = new Date().toISOString()
console.log('START', START, 'BASE', BASE, 'version', await fetch(`${BASE}/version.json`).then(r => r.text()))
const session = await mint(ADMIN_EMAIL); const adminUid = session.user?.id
const learnerIds = []
for (const uid of [adminUid, TEACHER.userId, LEADER.userId]) for (const r of await sb(`learners?user_id=eq.${uid}&select=id`)) learnerIds.push(r.id)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const results = []
const WIDTHS = [{ tag: 'phone', width: 390, height: 844, isMobile: true }, { tag: 'desktop', width: 1280, height: 800, isMobile: false }]

for (const p of [LEADER, TEACHER]) {
  for (const w of WIDTHS) {
    const label = `${p.role}-${w.tag}`
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: w.isMobile ? 2 : 1, isMobile: w.isMobile, hasTouch: w.isMobile })
    await ctx.addInitScript(([k, v, pk, pv]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); sessionStorage.setItem(pk, pv) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(session), 'ssi-viewing-as', JSON.stringify(p)])
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))
    await page.goto(`${BASE}/schools`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await settle(page)
    const r = { label, url: page.url(), errs }

    await page.screenshot({ path: path.join(SHOTS, `${label}-1-home.png`), fullPage: true })

    // 1. geometry: strip vs top bar
    const strip = page.locator('.viewing-as-banner')
    const bar = page.locator('.schools-topbar')
    r.stripPresent = await strip.count()
    r.barPresent = await bar.count()
    const sb_ = r.stripPresent ? await strip.first().boundingBox() : null
    const bb = r.barPresent ? await bar.first().boundingBox() : null
    r.stripBox = sb_; r.barBox = bb
    r.overlaps = !!(sb_ && bb) && !(sb_.x + sb_.width <= bb.x || bb.x + bb.width <= sb_.x || sb_.y + sb_.height <= bb.y || bb.y + bb.height <= sb_.y)

    // 2. no Learn button
    r.learnBtns = await page.locator('a.learn-btn').count()

    // 3. (phone) hamburger opens mobile nav
    if (w.isMobile) {
      const ham = page.locator('.nav-toggle')
      r.hamburgerPresent = await ham.count()
      if (r.hamburgerPresent) {
        await ham.first().click({ timeout: 5000 }).catch((e) => { r.hamburgerClickError = String(e.message).slice(0, 120) })
        await page.waitForTimeout(500)
        r.mobileNavOpen = await page.locator('.mobile-nav').count()
        await page.screenshot({ path: path.join(SHOTS, `${label}-2-mobile-nav.png`) })
        await ham.first().click({ timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(300)
      }
    }

    // 4. avatar menu opens and carries My player
    const trigger = page.locator('.user-trigger')
    r.avatarPresent = await trigger.count()
    await trigger.first().click({ timeout: 5000 }).catch((e) => { r.avatarClickError = String(e.message).slice(0, 120) })
    await page.waitForTimeout(500)
    r.avatarMenuOpen = await page.locator('.user-menu-pop').count()
    r.myPlayerInMenu = await page.locator('.user-menu-pop >> text=My player').count()
    r.learnInMenu = await page.locator('.user-menu-pop a.learn-btn').count()
    await page.screenshot({ path: path.join(SHOTS, `${label}-3-avatar-menu.png`) })
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('body').click({ position: { x: 5, y: w.isMobile ? 700 : 700 } }).catch(() => {})
    await page.waitForTimeout(400)

    // 5. Pages list on the strip
    const pages = page.locator('[data-testid="view-as-pages"]')
    r.pagesBtn = await pages.count()
    if (r.pagesBtn) {
      await pages.first().click({ timeout: 5000 }).catch((e) => { r.pagesClickError = String(e.message).slice(0, 120) })
      await page.waitForTimeout(400)
      r.pagesMenuRows = await page.locator('.aab-menu-item').count()
      await page.screenshot({ path: path.join(SHOTS, `${label}-4-pages.png`) })
    }
    results.push(r)
    console.log(label, JSON.stringify(r))
    await ctx.close()
  }
}
await browser.close()
await new Promise(r => setTimeout(r, 3000))
const pe = await sb(`player_events?user_id=in.(${learnerIds.join(',')})&occurred_at=gte.${START}&select=id,user_id,event_type`)
console.log('DB player_events since START (success = []):', JSON.stringify(pe))
fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ base: BASE, start: START, results, playerEvents: pe }, null, 2))
const fails = results.flatMap((r) => {
  const f = []
  if (r.overlaps) f.push(`${r.label}: strip OVERLAPS top bar`)
  if (r.learnBtns) f.push(`${r.label}: ${r.learnBtns} learn-btn in DOM`)
  if (!r.avatarMenuOpen) f.push(`${r.label}: avatar menu did not open`)
  if (!r.myPlayerInMenu) f.push(`${r.label}: My player missing from avatar menu`)
  if (!r.pagesMenuRows) f.push(`${r.label}: Pages list did not render`)
  if (r.label.endsWith('phone') && !r.mobileNavOpen) f.push(`${r.label}: hamburger did not open mobile nav`)
  return f
})
console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'ALL ASSERTIONS PASS')
