// SW STALE-SHELL REDEPLOY PROBE — the regression behind Tom's airplane-mode
// report on staging, 2026-09-12 (job #377). Replays the day:
//   1. build A is installed and its service worker controls the app;
//   2. build B is deployed; the worker updates, then activates once the app
//      is closed, so the precache now holds B's chunks and none of A's;
//   3. ONE navigation on a slow network — index.html takes longer than the
//      navigation route's 3s NetworkFirst timeout;
//   4. the app is closed, the network goes away, the app is relaunched.
// Before the fix, step 3 served the stale A shell from the runtime
// navigation-cache; its chunks were gone; the inline boot watchdog saw a
// same-origin script failure on a live network and "healed" — unregistered
// the worker and wiped every cache. The learner then had no offline app until
// a full reinstall completed. After the fix (src/sw/precachedShellPlugin.js)
// the timeout serves the PRECACHED shell, which boots, and nothing heals.
//
// Needs two built dist directories (A = what the phone runs now, B = the
// candidate) and the switchable server below, which serves whichever root
// the control file names and can delay index.html:
//   DIST_A=/path/dist-old DIST_B=/path/dist-new node e2e/sw-stale-shell-redeploy-probe.mjs
// Exit 0 = PASS, 1 = FAIL. Verified 2026-09-12: FAILS with A=1a99888 B=f731f19
// (both pre-fix), PASSES with A=f731f19 B=this fix.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const A = process.env.DIST_A, B = process.env.DIST_B
if (!A || !B) { console.error('DIST_A and DIST_B are required'); process.exit(2) }
const PORT = Number(process.env.PROBE_PORT || 4378)
const BASE = `http://localhost:${PORT}`
const CTL = path.join(process.env.CS_SCRATCH || os.tmpdir(), `sw-stale-shell-ctl-${process.pid}.json`)
const ctl = (o) => fs.writeFileSync(CTL, JSON.stringify(o))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

// --- switchable static server: root + index.html delay read per request ---
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json' }
const server = http.createServer((req, res) => {
  const c = JSON.parse(fs.readFileSync(CTL, 'utf8'))
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}') }
  let file = path.join(c.root, p); let isIndex = p === '/' || p === '/index.html'
  // Vercel's catch-all rewrite: anything missing, hashed chunks of a retired
  // build included, comes back as index.html with a 200.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(c.root, 'index.html'); isIndex = true }
  const send = () => {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable' })
    fs.createReadStream(file).pipe(res)
  }
  const delay = (p === '/' || p === '/index.html') ? (c.delayIndexMs || 0) : 0
  delay ? setTimeout(send, delay) : send()
})
await new Promise((r) => server.listen(PORT, r))

const swState = (page) => page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations(); const r = regs[0]
  const keys = await caches.keys(); const counts = {}
  for (const k of keys) counts[k] = (await (await caches.open(k)).keys()).length
  return { regs: regs.length, installing: !!r?.installing, waiting: !!r?.waiting, active: r?.active?.state || null, controller: !!navigator.serviceWorker.controller, caches: counts, booted: window.__SSI_BOOTED === true, build: localStorage.getItem('ssi-build-version') }
})

ctl({ root: A, delayIndexMs: 0 })
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined })
const ctx = await browser.newContext()
let page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'load' })
await page.evaluate(() => navigator.serviceWorker.ready)
await page.reload({ waitUntil: 'load' }); await sleep(1500)
// Stand-in for the learner's downloaded audio: IndexedDB must survive everything below.
await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open('probe-marker', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('s'); rq.onsuccess = () => { const tx = rq.result.transaction('s', 'readwrite'); tx.objectStore('s').put('audio-stands-here', 'k'); tx.oncomplete = () => res(true) } }))
const s1 = await swState(page)
console.log('1 build A installed:', JSON.stringify(s1))
check('build A worker controls the app with a precache', s1.controller && s1.active === 'activated')

ctl({ root: B, delayIndexMs: 0 })
await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update() })
let s2
for (let i = 0; i < 60; i++) { s2 = await swState(page); if (s2.waiting) break; await sleep(500) }
console.log('2 build B deployed, worker updated:', JSON.stringify(s2))
check('build B worker installed and waiting', s2.waiting === true)
// The phone no longer holds A's chunks anywhere but the precache: drop the
// browser HTTP cache, which on this box would otherwise quietly answer for a
// retired build's immutable chunks and hide the failure.
const cdp = await ctx.newCDPSession(page); await cdp.send('Network.clearBrowserCache'); await cdp.detach()
await page.close(); await sleep(3000) // no clients → B activates, precache drops A's chunks

// 3. One slow navigation: index.html arrives after 6s, past the 3s timeout.
ctl({ root: B, delayIndexMs: 6000 })
page = await ctx.newPage()
const docs = [], failed = [], logs = []
page.on('response', async (r) => { if (r.request().resourceType() === 'document') { let entry = null; try { entry = ((await r.text()).match(/assets\/index-[\w-]+\.js/) || [null])[0] } catch {} docs.push({ t: Date.now() - t0, fromSW: r.fromServiceWorker(), entry }) } })
page.on('requestfailed', (q) => failed.push({ t: Date.now() - t0, url: q.url().replace(BASE, ''), err: q.failure()?.errorText }))
page.on('console', (m) => { const x = m.text(); if (/heal|Updating|Build |PWA|preload|MIME|module/i.test(x)) logs.push({ t: Date.now() - t0, x: x.slice(0, 160) }) })
let sawHeal = false, sawFloor = false
const t0 = Date.now()
await page.goto(BASE + '/', { waitUntil: 'commit' }).catch((e) => console.log('goto error:', e.message))
let bootedAt = null
for (let i = 0; i < 200 && bootedAt === null; i++) {
  const st = await page.evaluate(() => ({ cls: document.getElementById('app')?.className || '', booted: window.__SSI_BOOTED === true })).catch(() => ({ cls: '', booted: false }))
  if (st.cls === 'ssi-boot-heal') sawHeal = true
  if (st.cls === 'ssi-boot-floor') sawFloor = true
  if (st.booted) bootedAt = Date.now() - t0
  await sleep(100)
}
// The watchdog counts its heals in sessionStorage, which survives the reloads it triggers.
const healAttempts = await page.evaluate(() => Number(sessionStorage.getItem('ssi-boot-heal-attempts') || 0)).catch(() => -1)
const s3 = { bootedAt, healAttempts, ...(await swState(page).catch((e) => ({ err: e.message }))) }
console.log('3 after one slow navigation (t+20s):', JSON.stringify({ sawHeal, sawFloor, docs, failed: failed.slice(0, 8), logs, ...s3 }))
check('no boot-heal fired on a slow navigation after the redeploy', !sawHeal && !sawFloor && healAttempts === 0 && docs.length === 1, `healScreen=${sawHeal} floor=${sawFloor} attempts=${healAttempts} documentLoads=${docs.length}`)
check('app booted from build B', s3.booted === true && /B|f731|dirty|local/.test(String(s3.build)), `build=${s3.build}`)
check('service worker still registered and active', s3.regs === 1 && s3.active === 'activated')
const marker = await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open('probe-marker', 1); rq.onsuccess = () => { const tx = rq.result.transaction('s'); const g = tx.objectStore('s').get('k'); g.onsuccess = () => res(g.result) }; rq.onerror = () => res(null) })).catch(() => null)
check('IndexedDB (downloaded audio) untouched', marker === 'audio-stands-here')

// 4. The moment the app is up: close it, lose the network, relaunch. No grace
// period — a phone that just healed is mid-reinstall here, and airplane mode
// does not wait for it.
ctl({ root: B, delayIndexMs: 0 })
await ctx.setOffline(true); await page.close(); await sleep(1000)
page = await ctx.newPage(); let navErr = null
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch((e) => { navErr = e.message })
await sleep(6000)
const body = (await page.textContent('body').catch(() => '')) || ''
const booted = await page.evaluate(() => window.__SSI_BOOTED === true).catch(() => false)
const s4 = await swState(page).catch((e) => ({ err: e.message }))
console.log('4 offline relaunch:', JSON.stringify({ navErr, bodyHead: body.slice(0, 60).replace(/\s+/g, ' '), booted, ...s4 }))
check('offline relaunch boots the app from the service worker', booted === true && !navErr, navErr || '')

await browser.close(); server.close(); try { fs.unlinkSync(CTL) } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
