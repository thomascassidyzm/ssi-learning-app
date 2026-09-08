/**
 * #401 — HALF of "Tap to update genuinely fetches new web code", proved
 * headlessly. The other half is Tom's: deploy a visible change to staging and
 * tap the button on the handset. Promoting to staging is not this job's to do,
 * so what is proved here is the MECHANISM, on the exact bundle this branch
 * builds, and the deploy-and-tap script is written up for him.
 *
 * The shape: load the app under the shell's user agent, let the service worker
 * take control, then change the SERVED code underneath it — a marker in
 * index.html, a new revision in the precache manifest, a new build id in
 * version.json — and show that
 *   1. registration.update() finds a new worker and it goes to WAITING rather
 *      than taking over, which is Tom's rule that an update never applies
 *      itself under a live page,
 *   2. applying it and reloading serves the NEW code.
 *
 * Under the old bundled APK neither step could happen at all: the app served
 * its own frozen assets from https://localhost, so there was no new code for
 * any worker to find.
 *
 * Run against a local preview of this branch's build:
 *   ./node_modules/.bin/vite preview --port 4401 --host 127.0.0.1 &
 *   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs node e2e/_401-update-mechanism.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4401'
const DIST = process.env.DIST_DIR || 'dist'
const MARKER = '__401_UPDATE_MARKER__'
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 SSiShell/android'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

// Keep the originals so the build is left exactly as it was found.
const files = ['index.html', 'sw.js', 'version.json'].map((f) => ({ f, before: readFileSync(`${DIST}/${f}`, 'utf8') }))
const restore = () => files.forEach(({ f, before }) => writeFileSync(`${DIST}/${f}`, before))

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA })
const page = await ctx.newPage()

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 })
  // clientsClaim is false on purpose — a worker never seizes a page that is
  // already running. So the FIRST load installs it and the next one is the one
  // it controls. That is the posture the update rule depends on, not a quirk
  // of this probe.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 })
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 500))
    return !!navigator.serviceWorker.controller
  })
  check('the service worker is controlling the page', controlled)
  check('the running code has no marker in it yet', !(await page.content()).includes(MARKER))

  // ── deploy a visible change, the way Vercel would ────────────────────────
  const html = readFileSync(`${DIST}/index.html`, 'utf8').replace('<head>', `<head><!-- ${MARKER} -->`)
  writeFileSync(`${DIST}/index.html`, html)
  const sw = readFileSync(`${DIST}/sw.js`, 'utf8')
    .replace(/\{url:"index\.html",revision:"([a-f0-9]+)"\}/, '{url:"index.html",revision:"401401401401401401401401401401ff"}')
  writeFileSync(`${DIST}/sw.js`, sw)
  const version = JSON.parse(readFileSync(`${DIST}/version.json`, 'utf8'))
  writeFileSync(`${DIST}/version.json`, JSON.stringify({ ...version, buildNumber: 'deadbee', buildTime: new Date().toISOString() }))
  console.log('  served code changed: marker in index.html, new precache revision, new build id')

  // ── the app notices ─────────────────────────────────────────────────────
  const waiting = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    await reg.update()
    for (let i = 0; i < 60 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 500))
    return { waiting: !!reg.waiting, stillControlledByOld: !!navigator.serviceWorker.controller }
  })
  check('a NEW service worker installed and is WAITING', waiting.waiting)
  check('it did NOT take over the live page by itself', waiting.stillControlledByOld)

  // ── applying it serves the new code ─────────────────────────────────────
  // The page may navigate itself the moment the new worker activates — that is
  // the app's own relaunch, and it destroys this execution context. Expected,
  // so it is caught rather than fatal.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
    await new Promise((r) => setTimeout(r, 1500))
  }).catch((e) => console.log(`  (the page relaunched under us: ${String(e).split('\n')[0]})`))
  await page.waitForTimeout(2_000)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
  check('after applying, the page IS the new code', (await page.content()).includes(MARKER))
  const live = await page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null))
  check('and the build id it reports is the new one', live?.buildNumber === 'deadbee', JSON.stringify(live))
} finally {
  restore()
  await browser.close()
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
