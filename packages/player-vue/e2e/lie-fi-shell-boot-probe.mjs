// LIE-FI SHELL BOOT PROBE — the weak-signal case, which is NOT airplane mode.
//
// Airplane mode (`context.setOffline(true)`) flips `navigator.onLine` to false
// and every request FAILS IMMEDIATELY. That is the condition every offline
// probe in this directory tests, and the app handles it well.
//
// Lie-fi is the opposite failure: the radio is up, `navigator.onLine` stays
// TRUE, requests are accepted by the stack and then HANG. Every branch that
// asks "are we offline?" answers "no" and waits forever. Tom hit exactly this
// on a weak cellular signal on 2026-08-16 and got a permanent white screen.
//
// This probe emulates it AT THE SERVER: a static server that, in lie-fi mode,
// accepts the connection and then never answers. That is the only faithful
// harness available here — CDP `Network.emulateNetworkConditions` attaches to
// the PAGE target, so the service worker's own fetches (the ones that decide
// whether the shell is served) sail through unthrottled, and Playwright's
// request routing does not intercept service worker requests at all. Both
// were tried first and both reported a healthy boot while the real device
// white-screened.
//
// Three runs against one build:
//   A  airplane mode  — regression check, must stay good
//   B  lie-fi         — the bug; run TWICE, because a destructive heal makes
//                       the second boot worse than the first
//   C  healthy        — reload still picks up fresh code
//
//   node e2e/lie-fi-shell-boot-probe.mjs
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const PORT = 4198
const BASE = `http://localhost:${PORT}`
const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}

// mode:
//   'ok'        serve normally
//   'hang'      accept the request and never answer — lie-fi
//   'dead'      refuse the connection — airplane mode's server side
//   'newdeploy' THE CHUNK TRAP. A weak signal is not uniform: an 11 KB
//               index.html can squeak through inside the service worker's
//               3-second navigation timeout while a 400 KB JS bundle cannot.
//               `dev` redeploys constantly, so that fresh HTML names chunk
//               hashes the old precache has never seen — and those sub-
//               resource fetches have no timeout at all. Shell paints, app
//               never mounts. Here: serve the HTML with its entry chunk
//               renamed to a hash nothing has cached, and hang everything else.
let mode = 'ok'
const heldSockets = new Set()

const server = createServer(async (req, res) => {
  if (mode === 'newdeploy') {
    const isDoc = (req.headers.accept || '').includes('text/html')
    if (isDoc) {
      const html = (await readFile(join(DIST, 'index.html'), 'utf8'))
        .replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/g, '/assets/index-NEWDEPLOY.js')
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' }).end(html)
      return
    }
    heldSockets.add(res.socket)
    req.socket.setTimeout(0)
    return
  }
  if (mode === 'hang') {
    // The whole point: the request is ACCEPTED, the socket stays open, and no
    // byte of a response ever arrives. navigator.onLine stays true.
    heldSockets.add(res.socket)
    req.socket.setTimeout(0)
    return
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
      // The SW must be revalidated like the real host does it.
      'Cache-Control': p.endsWith('sw.js') ? 'no-cache' : 'public, max-age=0',
    }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(PORT, r))
// How long a lie-fi boot is allowed to take before we call it a white screen.
// Tom's accepted airplane-mode experience is "3/4 secs"; 10s is generous.
const BOOT_BUDGET_MS = 10000

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// A fresh browser per scenario: a wedged lie-fi boot can take the whole
// browser down with it, and that must not silently skip the runs after it.
async function launch() {
  return chromium.launch({ executablePath: process.env.CHROME_BIN || undefined })
}

// State that tells us whether the app booted, and whether anything destroyed
// the install while it was merely on a bad network.
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
      cacheKeys,
      precached,
    }
  }).catch((e) => ({ error: e.message }))
}

async function installedContext(browser) {
  mode = 'ok'
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  // clientsClaim is false everywhere (2026-08-07), so the FIRST visit installs
  // the SW but is never controlled by it. Reload to become a returning learner.
  await page.reload({ waitUntil: 'load' })
  await page.evaluate(async () => {
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100))
  })
  await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: 30000 }).catch(() => {})
  const st = await bootState(page)
  check('setup: SW controls page with precache', st.controller && st.precached > 0, JSON.stringify({ controller: st.controller, precached: st.precached }))
  return { ctx, page }
}

// ── A — airplane mode (regression check) ────────────────────────────────────
console.log('\n=== A — airplane mode (regression check) ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  await ctx.setOffline(true)
  mode = 'dead'
  const t0 = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => console.log('reload error:', e.message))
  await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: BOOT_BUDGET_MS }).catch(() => {})
  const ms = Date.now() - t0
  const st = await bootState(page)
  console.log('A state:', JSON.stringify(st))
  check(`A: app boots offline within ${BOOT_BUDGET_MS}ms`, st.booted, `${ms}ms, class=${st.appClass}`)
  check('A: install survives (SW + precache intact)', st.registrations > 0 && st.precached > 0, JSON.stringify({ regs: st.registrations, precached: st.precached }))
  await ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}

// ── B — lie-fi (the bug), twice in one context ──────────────────────────────
console.log('\n=== B — lie-fi: online, but nothing ever arrives ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  mode = 'hang'
  for (const pass of [1, 2]) {
    const t0 = Date.now()
    await page.reload({ waitUntil: 'commit' }).catch((e) => console.log(`reload error (pass ${pass}):`, e.message))
    await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: BOOT_BUDGET_MS }).catch(() => {})
    const ms = Date.now() - t0
    const st = await bootState(page)
    console.log(`B pass ${pass} state:`, JSON.stringify(st))
    check(`B${pass}: navigator.onLine still true (this is lie-fi, not offline)`, st.onLine !== false, String(st.onLine))
    check(`B${pass}: app boots from cache within ${BOOT_BUDGET_MS}ms`, st.booted === true, `${ms}ms, class=${st.appClass} text="${st.appText}"`)
    check(`B${pass}: install survives — a bad network never deletes the SW or precache`,
      st.registrations > 0 && st.precached > 0,
      JSON.stringify({ regs: st.registrations, precached: st.precached, caches: st.cacheKeys }))
    // The destructive-heal signature: a 15s watchdog needs longer than the
    // boot budget to fire, so give pass 1 time to do its damage before pass 2.
    if (pass === 1) await page.waitForTimeout(20000)
  }
  await page.screenshot({ path: '/tmp/lie-fi-boot.png' }).catch(() => {})
  await ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}

// ── B2 — lie-fi + a fresh deploy: the chunk trap ────────────────────────────
console.log('\n=== B2 — lie-fi with a fresh deploy (HTML arrives, chunks hang) ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  mode = 'newdeploy'
  for (const pass of [1, 2]) {
    const t0 = Date.now()
    await page.reload({ waitUntil: 'commit' }).catch((e) => console.log(`reload error (pass ${pass}):`, e.message))
    await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: BOOT_BUDGET_MS }).catch(() => {})
    const ms = Date.now() - t0
    const st = await bootState(page)
    console.log(`B2 pass ${pass} state:`, JSON.stringify(st))
    check(`B2-${pass}: app boots from cache within ${BOOT_BUDGET_MS}ms`, st.booted === true, `${ms}ms, class=${st.appClass} text="${st.appText}"`)
    check(`B2-${pass}: install survives — a bad network never deletes the SW or precache`,
      st.registrations > 0 && st.precached > 0,
      JSON.stringify({ regs: st.registrations, precached: st.precached, caches: st.cacheKeys }))
    // Let the 15s boot watchdog have its say before the second pass — if it
    // heals, pass 2 starts with no service worker and no precache at all.
    if (pass === 1) await page.waitForTimeout(22000)
  }
  await page.screenshot({ path: '/tmp/lie-fi-newdeploy.png' }).catch(() => {})
  await ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}

// ── C — healthy network (must be unchanged) ─────────────────────────────────
console.log('\n=== C — healthy network (must be unchanged) ===')
{
  const browser = await launch()
  const { ctx, page } = await installedContext(browser)
  const t0 = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__SSI_BOOTED === true, null, { timeout: BOOT_BUDGET_MS }).catch(() => {})
  const ms = Date.now() - t0
  const st = await bootState(page)
  console.log('C state:', JSON.stringify(st))
  check('C: app boots on a healthy network', st.booted, `${ms}ms`)
  check('C: install intact', st.registrations > 0 && st.precached > 0, JSON.stringify({ regs: st.registrations, precached: st.precached }))
  await ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}

for (const s of heldSockets) { try { s.destroy() } catch { /* already gone */ } }
server.close()
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
