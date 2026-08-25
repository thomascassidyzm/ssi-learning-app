// LIE-FI THIRD-PARTY BOOT PROBE — the render-blocking cross-origin case.
//
// The sibling probe (lie-fi-shell-boot-probe.mjs) hangs requests AT THE
// LOCAL SERVER — a faithful harness for FIRST-PARTY stalls, and it is the
// shape this file reuses. Its blind spot: it never hangs a THIRD-PARTY
// request, so index.html's render-blocking cross-origin Google Fonts
// stylesheet (fonts.googleapis.com) sails through untested. On a real
// lie-fi connection that request is accepted and never answered — and a
// render-blocking <link rel=stylesheet> in <head> blocks first paint AND
// blocks execution of every classic <script> that follows it in the
// document, including the inline boot-heal watchdog itself. That watchdog
// is the thing that's supposed to rescue a stalled boot after 3s — so this
// isn't "first paint is slow", it's "the rescue mechanism never even runs".
//
// Root cause (found 2026-08-25, being fixed in parallel by self-hosting the
// fonts): packages/player-vue/index.html line ~28.
//
// THIS PROBE DOES NOT USE context.setOffline() OR route.abort() FOR
// THIRD-PARTY HOSTS. Both fail the request FAST, which is the offline path
// (handled fine) — not lie-fi, where navigator.onLine stays true and the
// request just never resolves. A route handler that never calls
// fulfill/abort/continue is the correct emulation: the request is accepted
// and hangs forever, exactly like a weak signal.
//
// Runs against one build:
//   i    third-party hangs, first-party fully healthy
//   ii   third-party hangs AND first-party subresources hang after the
//        document arrives (the full lie-fi case) — two reload passes,
//        because Tom's report was that the white screen SURVIVED reloads
//   iii  fully healthy (regression guard — must still pass, must still get
//        fresh code)
//   iv   a further repeat reload under case (ii)'s conditions, in a FRESH
//        context, proving the failure isn't a one-context fluke
//
// Assertion is on what a learner actually sees: time to first non-blank
// paint, and a screenshot check that the screen isn't uniformly white.
// window.__SSI_BOOTED is also checked, but never trusted alone — a script
// tag after a pending stylesheet can fail to execute at all, which is
// exactly this bug, so a boot-flag check alone would prove nothing about
// paint.
//
//   node e2e/lie-fi-thirdparty-boot-probe.mjs
import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const PORT = 4199
const BASE = `http://localhost:${PORT}`
const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const SHOT_DIR = process.env.PROBE_SHOT_DIR || join(tmpdir(), 'ssi-lie-fi-probe')
await mkdir(SHOT_DIR, { recursive: true })

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}

// server mode (first-party, local):
//   'ok'               serve normally
//   'hang-subresources' serve the HTML document normally, hang EVERYTHING
//                        else (JS/CSS/asset requests) — mirrors a weak
//                        signal where the small doc squeaks through the
//                        SW's navigation timeout but nothing else does
let serverMode = 'ok'
// third-party mode: 'ok' lets cross-origin requests hit the real internet;
// 'hang' accepts them and never answers.
let thirdPartyMode = 'ok'
const heldSockets = new Set()

const server = createServer(async (req, res) => {
  if (serverMode === 'hang-subresources') {
    const isDoc = (req.headers.accept || '').includes('text/html')
    if (!isDoc) {
      heldSockets.add(res.socket)
      req.socket.setTimeout(0)
      return
    }
    // fall through to serve the document normally
  }
  const url = new URL(req.url, BASE)
  let p = normalize(join(DIST, decodeURIComponent(url.pathname)))
  if (!p.startsWith(DIST)) { res.writeHead(403).end(); return }
  try {
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html')
  } catch { p = join(DIST, 'index.html') }
  try {
    const body = await readFile(p)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(p)] || 'application/octet-stream',
      'Cache-Control': p.endsWith('sw.js') ? 'no-cache' : 'public, max-age=0',
    }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(PORT, r))

// How long a lie-fi boot is allowed to take before we call it a white
// screen. Generous — this is measuring "does it ever recover", not tuning
// a tight SLA.
const BOOT_BUDGET_MS = 10000

// Whole-script safety net: a genuinely wedged renderer can make even
// browser.close() hang. Nothing here should legitimately take this long —
// bail loudly rather than sit forever if something upstream regresses.
const WATCHDOG = setTimeout(() => {
  console.error('\nWATCHDOG: probe exceeded its overall time budget — forcing exit')
  process.exit(2)
}, 6 * 60 * 1000)
WATCHDOG.unref?.()

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label || 'op'} hard timeout ${ms}ms`)), ms)),
])

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROME_BIN || undefined })
}

// Route every request through: same-origin (BASE) requests go to our local
// server, whose behaviour is controlled by `serverMode`; cross-origin
// requests either pass through to the real internet (`ok`) or hang forever
// (`hang`) — accepted by Playwright's routing layer, never resolved.
async function newContextWithRouting(browser) {
  const ctx = await browser.newContext()
  await ctx.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) { route.continue(); return }
    if (thirdPartyMode === 'hang') return // never fulfil/abort/continue — a true hang
    route.continue()
  })
  return ctx
}

// Sample the actual rendered pixels via screenshot — the only way to know
// whether the page PAINTED anything, independent of whether any of our own
// boot-flag JS ever got to run (which is exactly what this bug breaks).
async function paintState(page, shotName) {
  const shotPath = join(SHOT_DIR, shotName)
  let shotError = null
  // A page genuinely stuck behind a render-blocking resource can make even
  // the screenshot call itself stall — that is not a probe bug, it is more
  // evidence of the bug. Playwright's page.screenshot() waits on
  // `document.fonts.ready` before capturing, which itself never resolves
  // here (that IS the bug), so it times out with no file written. Fall back
  // to a raw CDP capture, which skips that wait and gets the actual
  // composited pixels — proof of exactly what a learner's screen shows.
  await page.screenshot({ path: shotPath, timeout: 8000 }).catch(async (e) => {
    shotError = e.message
    try {
      const cdp = await withTimeout(page.context().newCDPSession(page), 5000, 'newCDPSession')
      const { data } = await withTimeout(cdp.send('Page.captureScreenshot', { format: 'png' }), 5000, 'captureScreenshot')
      await (await import('node:fs/promises')).writeFile(shotPath, Buffer.from(data, 'base64'))
      shotError += ' (recovered via raw CDP capture, bypassing the font-ready wait)'
    } catch (e2) { shotError += ` :: CDP fallback also failed: ${e2.message}` }
  })
  let avg = null
  let isBlankWhite = null
  let decodeError = null
  try {
    const { data, info } = await sharp(shotPath).resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
    let r = 0, g = 0, b = 0
    const n = info.width * info.height
    for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2] }
    avg = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
    // Blank white: Chromium's un-painted canvas default, ~(255,255,255).
    // The app's own boot background is #e8e3dd (232,227,221) — well clear
    // of this threshold, so this does not false-positive on a normal boot.
    isBlankWhite = avg.r > 250 && avg.g > 250 && avg.b > 250
  } catch (e) { decodeError = e.message }
  return { shotPath, avg, isBlankWhite, shotError, decodeError }
}

async function bootState(page) {
  return page.evaluate(async () => {
    const el = document.getElementById('app')
    let cacheKeys = []
    let precached = 0
    try {
      cacheKeys = await caches.keys()
      const pre = cacheKeys.find((k) => k.includes('precache'))
      if (pre) precached = (await (await caches.open(pre)).keys()).length
    } catch { /* storage blocked */ }
    let regs = 0
    try { regs = (await navigator.serviceWorker.getRegistrations()).length } catch { /* ignore */ }
    return {
      booted: window.__SSI_BOOTED === true,
      onLine: navigator.onLine,
      appClass: el ? el.className : '(no #app)',
      appText: (el ? el.textContent : '').trim().slice(0, 80),
      controller: !!navigator.serviceWorker.controller,
      registrations: regs,
      precached,
    }
  }).catch((e) => ({ error: e.message }))
}

// Install a SW-controlled context the same way the sibling probe does:
// first visit installs (uncontrolled), reload becomes controlled.
async function installedContext(browser) {
  serverMode = 'ok'
  thirdPartyMode = 'ok'
  const ctx = await newContextWithRouting(browser)
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload({ waitUntil: 'load' })
  await page.evaluate(async () => {
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100))
  })
  await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: 30000 }).catch(() => {})
  const st = await bootState(page)
  check('setup: SW controls page with precache', st.controller && st.precached > 0, JSON.stringify({ controller: st.controller, precached: st.precached }))
  return { ctx, page }
}

async function reloadAndMeasure(page, label, shotName) {
  const t0 = Date.now()
  await page.reload({ waitUntil: 'commit' }).catch((e) => console.log(`${label} reload error:`, e.message))
  await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: BOOT_BUDGET_MS }).catch(() => {})
  const ms = Date.now() - t0
  const st = await bootState(page)
  const paint = await paintState(page, shotName)
  console.log(`${label} state:`, JSON.stringify({ ms, st, paint: { avg: paint.avg, isBlankWhite: paint.isBlankWhite, shot: paint.shotPath, shotError: paint.shotError, decodeError: paint.decodeError } }))
  return { ms, st, paint }
}

// ── (i) third-party hangs only, first-party healthy ─────────────────────────
console.log('\n=== (i) third-party hangs, first-party fully healthy ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  serverMode = 'ok'
  thirdPartyMode = 'hang'
  const r = await reloadAndMeasure(page, '(i)', 'i-thirdparty-hang.png')
  check('(i): page paints something (not blank white) within budget', r.paint.isBlankWhite === false, `avg=${JSON.stringify(r.paint.avg)}`)
  check('(i): app boots within budget', r.st.booted === true, `${r.ms}ms, class=${r.st.appClass} text="${r.st.appText}"`)
  await withTimeout(ctx.close(), 5000, 'ctx.close').catch(() => {})
  await withTimeout(browser.close(), 5000, 'browser.close').catch(() => {})
}

// ── (ii) full lie-fi: third-party + first-party subresources hang ──────────
console.log('\n=== (ii) full lie-fi: third-party hangs, doc arrives, subresources hang ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  serverMode = 'hang-subresources'
  thirdPartyMode = 'hang'
  for (const pass of [1, 2]) {
    const r = await reloadAndMeasure(page, `(ii) pass ${pass}`, `ii-full-lie-fi-pass${pass}.png`)
    check(`(ii)-${pass}: navigator.onLine still true (this is lie-fi, not offline)`, r.st.onLine !== false, String(r.st.onLine))
    check(`(ii)-${pass}: page paints something (not blank white) within budget`, r.paint.isBlankWhite === false, `avg=${JSON.stringify(r.paint.avg)}`)
    check(`(ii)-${pass}: app boots within budget`, r.st.booted === true, `${r.ms}ms, class=${r.st.appClass} text="${r.st.appText}"`)
    check(`(ii)-${pass}: install survives — a bad network never deletes the SW or precache`, r.st.registrations > 0 && r.st.precached > 0, JSON.stringify({ regs: r.st.registrations, precached: r.st.precached }))
    // Give the 15s "network answered → heal" watchdog time to fire (or not)
    // before the second pass, same margin the sibling probe uses.
    if (pass === 1) await page.waitForTimeout(20000)
  }
  await withTimeout(ctx.close(), 5000, 'ctx.close').catch(() => {})
  await withTimeout(browser.close(), 5000, 'browser.close').catch(() => {})
}

// ── (iii) fully healthy — regression guard ──────────────────────────────────
console.log('\n=== (iii) fully healthy (regression guard) ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  serverMode = 'ok'
  thirdPartyMode = 'ok'
  const r = await reloadAndMeasure(page, '(iii)', 'iii-healthy.png')
  check('(iii): page paints (not blank white)', r.paint.isBlankWhite === false, `avg=${JSON.stringify(r.paint.avg)}`)
  check('(iii): app boots on a healthy network', r.st.booted === true, `${r.ms}ms`)
  check('(iii): install intact', r.st.registrations > 0 && r.st.precached > 0, JSON.stringify({ regs: r.st.registrations, precached: r.st.precached }))
  await withTimeout(ctx.close(), 5000, 'ctx.close').catch(() => {})
  await withTimeout(browser.close(), 5000, 'browser.close').catch(() => {})
}

// ── (iv) fresh context, repeat reload under case (ii)'s conditions ──────────
// Proves the failure isn't a one-context fluke and that it recurs on a
// brand-new reload cycle, matching Tom's report that the white screen
// SURVIVED reloads.
console.log('\n=== (iv) fresh context, repeat reload under full lie-fi conditions ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  serverMode = 'hang-subresources'
  thirdPartyMode = 'hang'
  for (const pass of [1, 2, 3]) {
    const r = await reloadAndMeasure(page, `(iv) pass ${pass}`, `iv-repeat-pass${pass}.png`)
    check(`(iv)-${pass}: page paints something (not blank white) within budget`, r.paint.isBlankWhite === false, `avg=${JSON.stringify(r.paint.avg)}`)
    check(`(iv)-${pass}: app boots within budget`, r.st.booted === true, `${r.ms}ms, class=${r.st.appClass} text="${r.st.appText}"`)
    if (pass < 3) await page.waitForTimeout(5000)
  }
  await withTimeout(ctx.close(), 5000, 'ctx.close').catch(() => {})
  await withTimeout(browser.close(), 5000, 'browser.close').catch(() => {})
}

for (const s of heldSockets) { try { s.destroy() } catch { /* already gone */ } }
server.close()
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
