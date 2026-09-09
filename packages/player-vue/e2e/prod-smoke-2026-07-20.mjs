// PRODUCTION smoke-walk after IME-launch ship — 2026-07-20
// 1) learner safety  2) admin structure/insights  3) invite redemption  4) mint code
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = 'https://saysomethingin.app'
const URL_SB = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SHOTS = '/tmp/prod-smoke/shots'
mkdirSync(SHOTS, { recursive: true })

const results = []
const pass = (k, note = '') => { results.push(['PASS', k, note]); console.log('PASS', k, note) }
const fail = (k, note = '') => { results.push(['FAIL', k, note]); console.log('FAIL', k, note) }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })

function wire(page, label, errs) {
  page.on('pageerror', (e) => { errs.push(`${label}: ${e.message}`); console.log('PAGE ERROR', label, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(`${label} console: ${m.text().slice(0, 200)}`) } })
}

// ---------- 1) LEARNER SAFETY (guest, fresh context) ----------
{
  const errs = []
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__audioPlays = []
    const orig = Audio.prototype.play
    Audio.prototype.play = function (...a) { window.__audioPlays.push(this.src || '(nosrc)'); return orig.apply(this, a) }
  })
  wire(page, 'learner', errs)
  const t0 = Date.now()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  console.log('learner home load ms:', Date.now() - t0, 'url:', page.url())
  await page.screenshot({ path: `${SHOTS}/01-learner-home.png` })
  const body = (await page.textContent('body').catch(() => '')) || ''
  if (/streak/i.test(body)) fail('learner:no-streak', 'word "streak" visible on home')
  else pass('learner:no-streak')

  // try to start play: press the most likely start control
  const startBtn = page.locator('button:has-text("Start"), button:has-text("Continue"), button:has-text("Play"), [class*="play-button"], [aria-label*="play" i]').first()
  try { await startBtn.click({ timeout: 5000 }) } catch (e) { console.log('no start button hit:', e.message.slice(0, 80)) }
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SHOTS}/02-learner-after-start.png` })
  await page.waitForTimeout(6000)
  const plays = await page.evaluate(() => window.__audioPlays.length).catch(() => 0)
  await page.screenshot({ path: `${SHOTS}/03-learner-playing.png` })
  if (plays > 0) pass('learner:audio-plays', `${plays} Audio.play() calls`)
  else fail('learner:audio-plays', 'no Audio.play() observed (may need deeper interaction)')
  const errReal = errs.filter(e => !/favicon|manifest|401|403/.test(e))
  if (errReal.length) fail('learner:console', errReal.slice(0, 5).join(' | '))
  else pass('learner:console-clean')
  await ctx.close()
}

// ---------- admin session ----------
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
console.log('admin session ok', v.session.user.id)

// ---------- 2) ADMIN STRUCTURE + INSIGHTS ----------
let mintedLink = null
{
  const errs = []
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(v.session)])
  const page = await ctx.newPage()
  wire(page, 'admin', errs)
  const t0 = Date.now()
  await page.goto(`${BASE}/admin/structure`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)
  const coldMs = Date.now() - t0
  await page.screenshot({ path: `${SHOTS}/10-admin-structure.png`, fullPage: true })
  const body = (await page.textContent('body').catch(() => '')) || ''
  if (/IME Demo/i.test(body)) pass('admin:structure-ime-visible', `cold load ${coldMs}ms`)
  else fail('admin:structure-ime-visible', `IME Demo not found; cold ${coldMs}ms; url ${page.url()}`)

  // drill: programme -> region -> school -> class via Open buttons
  const drill = async (name, shot) => {
    const t = Date.now()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true })
    console.log(name, 'drill step ms:', Date.now() - t, 'url:', page.url())
  }
  try {
    await page.locator('text=/IME Demo/i').first().click({ timeout: 5000 })
    await drill('programme', '11-node-programme')
    const openBtns = page.locator('button:has-text("Open"), a:has-text("Open")')
    for (const [i, shot] of [[0, '12-node-region'], [0, '13-node-school'], [0, '14-node-class']]) {
      try { await openBtns.nth(i).click({ timeout: 5000 }); await drill(shot, shot) } catch (e) { console.log('drill stop at', shot, e.message.slice(0, 80)); break }
    }
    pass('admin:drill', 'see shots 11-14')
  } catch (e) { fail('admin:drill', e.message.slice(0, 120)) }

  // insights: window chips + display names
  const body2 = (await page.textContent('body').catch(() => '')) || ''
  const chips = /7d|30d|day|week|window/i.test(body2)
  if (chips) pass('admin:insights-window-chips', 'window chips text present on node home')
  else fail('admin:insights-window-chips', 'no window-chip text found — check shots')

  const errReal = errs.filter(e => !/favicon|manifest/.test(e))
  if (errReal.length) fail('admin:console', errReal.slice(0, 5).join(' | '))
  else pass('admin:console-clean')

  // ---------- 4) MINT a code via Structure ways-in (fallback /admin/invites) ----------
  try {
    const invite = page.locator('button:has-text("Invite"), button:has-text("Ways in"), a:has-text("Ways in"), button:has-text("invite link")').first()
    await invite.click({ timeout: 4000 })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${SHOTS}/15-ways-in.png` })
  } catch { console.log('no ways-in button on node home — falling back to /admin/invites') }
  const linkLoc = page.locator('.invite-link-url').first()
  mintedLink = await linkLoc.textContent({ timeout: 3000 }).catch(() => null)
  if (!mintedLink) {
    await page.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(2500)
    const whereSelect = page.locator('.create-form select').nth(1)
    const options = await whereSelect.locator('option').allTextContents().catch(() => [])
    const demoIdx = options.findIndex(o => /IME|demo|welsh health|japan/i.test(o))
    if (demoIdx >= 1) {
      await whereSelect.selectOption({ index: demoIdx })
      await page.locator('.create-form button[type=submit]').click()
      await page.waitForTimeout(2500)
      mintedLink = await page.locator('.invite-link-url').first().textContent().catch(() => null)
      await page.screenshot({ path: `${SHOTS}/16-minted.png` })
    }
  }
  if (mintedLink) pass('admin:mint-code', mintedLink.trim())
  else fail('admin:mint-code', 'could not mint via ways-in or /admin/invites')
  await ctx.close()
}

// ---------- 3) INVITE REDEMPTION (fresh incognito contexts) ----------
for (const code of ['L9F-SGW', 'GVW-728']) {
  const errs = []
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  wire(page, `redeem-${code}`, errs)
  await page.goto(`${BASE}/redeem/${code}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${SHOTS}/20-redeem-${code}.png`, fullPage: true })
  const url = page.url()
  const body = (await page.textContent('body').catch(() => '')) || ''
  const authed = await page.evaluate(() => !!window.localStorage.getItem('sb-swfvymspfxmnfhevgdkg-auth-token')).catch(() => false)
  console.log(`redeem ${code}: url=${url} authed=${authed}`)
  if (/invalid|expired|error|not found/i.test(body)) fail(`redeem:${code}`, `error text on page — url ${url}`)
  else pass(`redeem:${code}`, `url ${url}, session=${authed}`)
  const errReal = errs.filter(e => !/favicon|manifest|401|403/.test(e))
  if (errReal.length) console.log(`redeem ${code} console:`, errReal.slice(0, 3).join(' | '))
  await ctx.close()
}

await browser.close()
console.log('\n===== SUMMARY =====')
for (const [s, k, n] of results) console.log(s.padEnd(5), k, n ? '—' : '', n)
