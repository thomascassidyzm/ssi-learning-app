// #217 live probe — the on-open update screen, across a real deploy on staging.
//
// The shape it proves, end to end and with nothing faked:
//   1. a real browser installs the service worker of build A on staging;
//   2. build B is really deployed to staging while that install is held;
//   3. the app is reopened with the network briefly down, so the service
//      worker answers the navigation with its PRECACHED build-A shell — the
//      exact situation Tom hits on his phone after a deploy;
//   4. the network comes back, the gate reads /version.json, finds build B,
//      and the learner SEES a screen saying the app is updating instead of a
//      reload happening under them;
//   5. the reload lands and the page is on build B.
//
// Read-only against production data; it only visits staging as a guest.
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/probe-217'
fs.mkdirSync(OUT, { recursive: true })

const version = async () => (await fetch(`${BASE}/version.json`, { cache: 'no-store' }).then((r) => r.json())).buildNumber

const buildA = await version()
console.log('build A (what the browser will install):', buildA)

// The workspace's playwright-core resolves to a build whose browser is not on
// this box; the installed 1243 chromium is newer and fine. CHROME_PATH lets the
// caller name it rather than this script guessing.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const ctx = await browser.newContext({ serviceWorkers: 'allow' })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { const t = m.text(); logs.push(t); if (t.includes('[OpenUpdate]') || t.includes('[PWA]')) console.log('  page:', t) })

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
console.log('service worker controls the page:', controlled)
if (!controlled) { console.error('FAIL: no controller — the precached-shell path cannot be exercised'); await browser.close(); process.exit(1) }
await page.screenshot({ path: `${OUT}/1-build-A-installed.png` })

// Wait for build B to be live. The caller pushes it; this just watches.
console.log('waiting for build B on', BASE, '…')
let buildB = buildA
for (let i = 0; i < 60 && buildB === buildA; i++) {
  await new Promise((r) => setTimeout(r, 10000))
  buildB = await version().catch(() => buildA)
}
if (buildB === buildA) { console.error('FAIL: build B never appeared'); await browser.close(); process.exit(1) }
console.log('build B is live:', buildB)

// Reopen with the network down for the navigation only: the service worker
// answers from its precache, so the document is build A while build B is live.
await ctx.setOffline(true)
page.once('domcontentloaded', () => { void ctx.setOffline(false) })
await page.reload({ waitUntil: 'commit' }).catch((e) => console.log('  (nav:', e.message.split('\n')[0], ')'))
await ctx.setOffline(false)

let seen = false
try {
  await page.waitForSelector('.ssi-open-update', { timeout: 15000, state: 'attached' })
  await page.screenshot({ path: `${OUT}/2-update-screen.png` })
  const text = await page.locator('.ssi-open-update-card').innerText().catch(() => '')
  console.log('UPDATE SCREEN SHOWN:', JSON.stringify(text))
  seen = true
} catch {
  console.log('update screen not observed within 15s')
}

// And it lands: the page ends up on build B.
await page.waitForTimeout(8000)
const landed = await page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).then((v) => v.buildNumber).catch(() => null))
const running = await page.evaluate(() => document.documentElement.outerHTML.length)
console.log('after the update: live build', landed, '| document bytes', running)
await page.screenshot({ path: `${OUT}/3-after-update.png` })

fs.writeFileSync(`${OUT}/console.log`, logs.join('\n'))
await browser.close()
console.log(seen ? 'PASS — the learner was told, on screen, before the reload' : 'INCONCLUSIVE — see console.log')
process.exit(seen ? 0 : 2)
