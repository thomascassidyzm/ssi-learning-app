// CSP AUDIT PROBE — collects Content-Security-Policy-Report-Only violations
// across surfaces that couldn't be exercised from a local build: signed-in
// learner audio playback, offline bulk download, /schools + /admin
// dashboards, and (best-effort) the Paddle checkout overlay.
//
//   node e2e/csp-audit-probe.mjs
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = process.env.OUT_DIR || '/tmp/csp-audit/'
mkdirSync(OUT, { recursive: true })

const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+bumface@gmail.com'
const ADMIN_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const TEACHER_LINK = process.env.TEACHER_LINK || `${BASE}/redeem/ZKD-834`
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const svc = createClient(SB_URL, serviceKey)

async function mintSession(email) {
  const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  if (lerr) throw lerr
  const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
  if (verr) throw verr
  return v.session
}

const ALL_VIOLATIONS = [] // { surface, directive, blocked, src, line }

function isEruda(v) {
  return /\/assets\/eruda-/.test(v.blocked || '') || /\/assets\/eruda-/.test(v.src || '')
}

async function collectFrom(page) {
  const v = await page.evaluate(() => window.__v || []).catch(() => [])
  return v.filter((x) => !isEruda(x))
}

async function setupPage(ctx, session, extraLocalStorage = {}) {
  await ctx.addInitScript(([key, sess, extras]) => {
    window.__v = []
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__v.push({ directive: e.violatedDirective, blocked: e.blockedURI, src: e.sourceFile, line: e.lineNumber })
    })
    try {
      localStorage.setItem('ssi-has-played', 'true')
      if (sess) localStorage.setItem(key, JSON.stringify(sess))
      for (const [k, val] of Object.entries(extras || {})) localStorage.setItem(k, val)
    } catch {}
  }, [`sb-${projectRef}-auth-token`, session, extraLocalStorage])
  const page = await ctx.newPage()
  const failedReqs = []
  page.on('requestfailed', (req) => failedReqs.push({ url: req.url(), failure: req.failure()?.errorText }))
  return { page, failedReqs }
}

function report(surface, violations, failedReqs, note = '') {
  console.log(`\n===== SURFACE: ${surface} =====`)
  if (note) console.log('NOTE:', note)
  console.log(`violations: ${violations.length}, failed requests: ${failedReqs.length}`)
  for (const v of violations) console.log(' VIOLATION', JSON.stringify(v))
  for (const f of failedReqs.slice(0, 20)) console.log(' FAILEDREQ', JSON.stringify(f))
  for (const v of violations) ALL_VIOLATIONS.push({ surface, ...v })
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.CHROME_BIN || undefined,
})

// ── SURFACE 1: signed-in learner, real audio playback ───────────────────────
{
  const session = await mintSession(TESTER)
  console.log(`minted tester session for ${TESTER}`)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const { page, failedReqs } = await setupPage(ctx, session)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
  await page.waitForTimeout(4000)
  let started = false
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) { try { await btn.click({ timeout: 8000 }); started = true; break } catch {} }
  }
  console.log('lesson started:', started)
  // let 2-3 full cycles play (~11s each per CLAUDE.md timing)
  await page.waitForTimeout(45000)
  const v = await collectFrom(page)
  await page.screenshot({ path: `${OUT}1-audio-playback.png` }).catch(() => {})
  report('signed-in learner audio playback', v, failedReqs, started ? '' : 'GAP: could not find a start/continue button to begin playback')
  await ctx.close()
}

// ── SURFACE 2: offline bulk download ─────────────────────────────────────────
{
  const session = await mintSession(TESTER)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const { page, failedReqs } = await setupPage(ctx, session)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
  await page.waitForTimeout(4000)
  let started = false
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) { try { await btn.click({ timeout: 8000 }); started = true; break } catch {} }
  }
  await page.waitForTimeout(6000)
  let gap = ''
  const trigger = page.locator('.mode-trigger')
  const triggerVisible = await trigger.isVisible({ timeout: 8000 }).catch(() => false)
  if (!triggerVisible) gap = 'GAP: .mode-trigger not visible, could not open mode tray'
  else {
    await trigger.click({ timeout: 10000 }).catch(() => {})
    const offlineRow = page.locator('.tray-item', { hasText: /offline/i }).first()
    const offlineVisible = await offlineRow.isVisible({ timeout: 8000 }).catch(() => false)
    if (!offlineVisible) gap = 'GAP: offline row not visible in mode tray'
    else {
      await offlineRow.click().catch(() => {})
      const dlBtn = page.locator('.offline-depth-download').first()
      const dlVisible = await dlBtn.isVisible({ timeout: 8000 }).catch(() => false)
      if (!dlVisible) gap = 'GAP: offline depth-picker download button not visible'
      else {
        await dlBtn.click().catch(() => {})
        console.log('offline download triggered, waiting for progress...')
        await page.waitForTimeout(30000)
      }
    }
  }
  const v = await collectFrom(page)
  await page.screenshot({ path: `${OUT}2-offline-download.png` }).catch(() => {})
  report('offline bulk audio download', v, failedReqs, gap)
  await ctx.close()
}

// ── SURFACE 3a: teacher /schools dashboard ───────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const { page, failedReqs } = await setupPage(ctx, null)
  let gap = ''
  await page.goto(TEACHER_LINK, { waitUntil: 'networkidle' }).catch((e) => { gap = `GAP: goto teacher link failed: ${e.message}` })
  await page.waitForTimeout(5000)
  if (!page.url().includes('/schools')) gap = gap || `GAP: teacher link did not land on /schools (landed on ${page.url()})`
  else {
    // walk a couple of tabs
    for (const tabText of ['Students', 'Insights', 'Dashboard']) {
      const tab = page.locator('.tabs a', { hasText: tabText }).first()
      if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(3000) }
    }
    // try Play as class
    const playBtn = page.locator('button', { hasText: /Play as class/ }).first()
    if (await playBtn.count()) { await playBtn.click().catch(() => {}); await page.waitForTimeout(5000) }
  }
  const v = await collectFrom(page)
  await page.screenshot({ path: `${OUT}3a-schools-teacher.png` }).catch(() => {})
  report('/schools teacher dashboard', v, failedReqs, gap)
  await ctx.close()
}

// ── SURFACE 3b: ssi_admin dashboard ──────────────────────────────────────────
{
  const session = await mintSession(ADMIN_EMAIL)
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const { page, failedReqs } = await setupPage(ctx, session, { 'ssi-user-role': JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null }) })
  let gap = ''
  await page.goto(BASE + '/schools/all', { waitUntil: 'networkidle' }).catch((e) => { gap = `GAP on /schools/all: ${e.message}` })
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${OUT}3b-admin-schools-all.png` }).catch(() => {})
  const v1 = await collectFrom(page)
  report('/schools/all govt_admin view', v1, [], gap)

  gap = ''
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle' }).catch((e) => { gap = `GAP on /admin: ${e.message}` })
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${OUT}3c-admin-root.png` }).catch(() => {})
  const v2 = await collectFrom(page)
  report('/admin root', v2, failedReqs, gap)
  await ctx.close()
}

// ── SURFACE 4: Paddle checkout overlay (best effort, no payment submitted) ──
{
  const session = await mintSession(TESTER)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const { page, failedReqs } = await setupPage(ctx, session)
  let gap = ''
  await page.goto(BASE + '/?screen=settings', { waitUntil: 'networkidle' }).catch((e) => { gap = `GAP: goto ?screen=settings failed: ${e.message}` })
  await page.waitForTimeout(4000)
  const goPremiumRow = page.locator('.setting-row.clickable', { hasText: /Premium|Upgrade|Go Premium/i }).first()
  const rowVisible = await goPremiumRow.isVisible({ timeout: 8000 }).catch(() => false)
  if (!rowVisible) {
    gap = gap || 'GAP: could not find a Premium/Upgrade settings row to trigger checkout — this tester may already be subscribed, or the selector text differs'
  } else {
    await goPremiumRow.click().catch(() => {})
    await page.waitForTimeout(6000)
    // Look for the CheckoutOverlay's inline Paddle frame host, and/or a Paddle iframe.
    const overlayVisible = await page.locator('.checkout-overlay, [class*="checkout"]').first().isVisible({ timeout: 5000 }).catch(() => false)
    const paddleIframe = await page.locator('iframe[src*="paddle.com"]').count().catch(() => 0)
    console.log(`checkout overlay visible=${overlayVisible} paddle iframes=${paddleIframe}`)
    await page.waitForTimeout(6000) // let cdn.paddle.com script + iframe finish loading
    gap = gap + (overlayVisible || paddleIframe > 0 ? '' : ' GAP: clicked the Premium row but neither the checkout overlay nor a paddle.com iframe appeared')
  }
  const v = await collectFrom(page)
  await page.screenshot({ path: `${OUT}4-paddle-checkout.png` }).catch(() => {})
  report('Paddle checkout overlay', v, failedReqs, gap.trim())
  await ctx.close()
}

await browser.close()

console.log('\n\n===== SUMMARY: ALL DISTINCT VIOLATIONS (excluding eruda) =====')
const seen = new Set()
for (const v of ALL_VIOLATIONS) {
  const key = `${v.surface}|${v.directive}|${v.blocked}|${v.src}|${v.line}`
  if (seen.has(key)) continue
  seen.add(key)
  console.log(JSON.stringify(v))
}
if (ALL_VIOLATIONS.length === 0) console.log('(none observed)')
