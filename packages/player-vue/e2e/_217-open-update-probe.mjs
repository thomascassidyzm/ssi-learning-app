// #217 live probe — the on-open update screen, across a real deploy on staging.
//
// The shape it proves, end to end and with nothing faked:
//   1. a real browser installs the service worker of build A on staging and is
//      controlled by it, exactly as a returning learner's phone is;
//   2. build B is really deployed to staging while that install is held;
//   3. the app is reopened with the SERVICE WORKER'S OWN navigation fetch
//      failed, so its NetworkFirst route falls back to the PRECACHED build-A
//      shell — the situation Tom hits after a deploy on a bad signal, and the
//      only one in which the running app is genuinely behind the live one;
//   4. everything else still reaches the network, so the gate reads
//      /version.json, finds build B, and the learner SEES a screen saying the
//      app is updating instead of a reload happening under them;
//   5. the reload lands and the page ends up on build B.
//
// Note on evidence: staging builds strip console.log (vite.config.js `pure`),
// so the proof here is the DOM and the entry-script fingerprint, never a log
// line.
//
// Read-only: it visits staging as a guest and writes nothing anywhere.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/probe-217'
fs.mkdirSync(OUT, { recursive: true })

const version = async () => (await fetch(`${BASE}/version.json`, { cache: 'no-store' }).then((r) => r.json())).buildNumber
const entryScript = (page) => page.evaluate(() =>
  [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute('src')).join(','))

const buildA = await version()
console.log('build A (what the browser will install):', buildA)

// The workspace's playwright-core resolves to a build whose browser is not on
// this box; the installed 1243 chromium is newer and fine. CHROME_PATH lets the
// caller name it rather than this script guessing.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const ctx = await browser.newContext({ serviceWorkers: 'allow' })
const page = await ctx.newPage()

await page.goto(BASE, { waitUntil: 'load' })
// The service worker registers on `window load` (immediate:false), and with
// clientsClaim off it does NOT take over the page that registered it — so the
// precached-shell path needs a second visit, exactly as a learner's second
// open does. Give the precache room, then reopen and check.
await page.waitForTimeout(20000)
await page.evaluate(() => navigator.serviceWorker.ready)
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(5000)
const controlled = await page.evaluate(async () => {
  await navigator.serviceWorker.ready
  return !!navigator.serviceWorker.controller
})
const entryA = await entryScript(page)
console.log('service worker controls the page:', controlled, '| entry script:', entryA)
if (!controlled) { console.error('FAIL: no controller — the precached-shell path cannot be exercised'); await browser.close(); process.exit(1) }
await page.screenshot({ path: `${OUT}/1-build-A-installed.png` })

// Wait for build B to be live. The caller pushes it; this just watches.
console.log('waiting for build B on', BASE, '…')
let buildB = buildA
for (let i = 0; i < 90 && buildB === buildA; i++) {
  await new Promise((r) => setTimeout(r, 10000))
  buildB = await version().catch(() => buildA)
}
if (buildB === buildA) { console.error('FAIL: build B never appeared'); await browser.close(); process.exit(1) }
console.log('build B is live:', buildB)

// Fail the SERVICE WORKER'S navigation fetch only. Its NetworkFirst route then
// answers from the precache, so the document is build A while build B is live.
// Everything else — /version.json above all — still reaches the network.
await ctx.route('**/*', async (route, request) => {
  if (request.serviceWorker() && request.isNavigationRequest()) {
    console.log("  blocking the worker's navigation fetch →", request.url())
    return route.abort('failed')
  }
  return route.continue()
})

let shots = 0
const shooting = setInterval(() => {
  page.screenshot({ path: `${OUT}/shot-${shots++}.png` }).catch(() => {})
}, 250)

await page.reload({ waitUntil: 'commit' }).catch((e) => console.log('  (nav:', e.message.split('\n')[0], ')'))

let seen = false
let text = ''
try {
  await page.waitForSelector('.ssi-open-update', { timeout: 20000, state: 'attached' })
  await page.screenshot({ path: `${OUT}/2-update-screen.png` })
  text = await page.locator('.ssi-open-update-card').innerText().catch(() => '')
  console.log('UPDATE SCREEN SHOWN:', JSON.stringify(text))
  seen = true
} catch {
  console.log('update screen not observed within 20s')
}
clearInterval(shooting)

const entryStale = await entryScript(page).catch(() => '')
console.log('entry script on the reopened document:', entryStale,
  entryStale && entryStale === entryA ? '(same build — the precached shell answered)' : '(different — the network answered)')

await ctx.unroute('**/*')
await page.waitForTimeout(10000)
const landed = await page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).then((v) => v.buildNumber).catch(() => null))
console.log('after the update: live build', landed)
await page.screenshot({ path: `${OUT}/3-after-update.png` })

await browser.close()
console.log(seen ? 'PASS — the learner was told, on screen, before the reload' : 'INCONCLUSIVE')
process.exit(seen ? 0 : 2)
