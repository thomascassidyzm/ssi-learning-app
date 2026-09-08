/**
 * #406 — THE OTHER HALF of the tap-to-update proof: against a REAL deploy.
 *
 * #401 proved the mechanism by mutating a local `dist` underneath a running
 * page — honest, and it said so. What it could not do was show the same thing
 * happening across a genuine deployment, because it had no deploy of its own.
 * This does. The two assertions are #401's, unchanged; only the "deploy" is
 * real, and the build id asserted on is a value production chose rather than
 * a marker this probe injected.
 *
 * WHY IT IS TWO PHASES. A real deploy takes minutes, so the shell has to be
 * warmed BEFORE it lands and updated AFTER. Chromium's persistent context
 * carries the service-worker registration and its precache across process
 * lifetimes on disk, which is exactly the handset's situation: the app was
 * installed and opened yesterday, new code shipped overnight, the learner taps
 * the button today.
 *
 * WHAT IT PROVES, in order:
 *   warm  — the shell registers a service worker on production, takes control,
 *           and finds NO update while production has not moved. That negative
 *           is the evidence that the positive below is caused by the deploy.
 *   apply — after a real deploy, the page opens on the OLD code still (the
 *           precache serving it, an update never seizing a live page);
 *           registration.update() finds a new worker and it goes to WAITING;
 *           applying it and reloading serves the NEW code, asserted on the
 *           build id baked into the bundle, read from where the app itself
 *           records it.
 *
 * The user agent carries `SSiShell/android`, so the app takes the WebView
 * branch of the platform seam exactly as it does inside the APK.
 *
 * Run:
 *   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs PHASE=warm  node e2e/_406-update-on-production.mjs
 *   ...land a deploy on main and wait for /version.json to move...
 *   LD_LIBRARY_PATH=$HOME/.ssi-sentinel-libs PHASE=apply node e2e/_406-update-on-production.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const PHASE = process.env.PHASE || 'warm'
const ROOT = process.env.OUT_DIR || `${process.env.CS_SCRATCH || '.'}/406-update-on-production`
const PROFILE = `${ROOT}/profile`
const STATE = `${ROOT}/state.json`
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 SSiShell/android'

mkdirSync(PROFILE, { recursive: true })
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * The build id of the code ACTUALLY RUNNING in the page, not the one the
 * network would hand out now. App.vue writes `__BUILD_NUMBER__` — the constant
 * Vite bakes into the bundle and Settings displays — into localStorage under
 * `ssi-build-version` whenever it changes. So this reads the bundle's own
 * identity through the app's own bookkeeping, which is the thing the update is
 * supposed to move.
 */
const runningBuild = (page) => page.evaluate(() => localStorage.getItem('ssi-build-version'))
const servedBuild = (page) =>
  page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 390, height: 844 },
  userAgent: UA,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || (await ctx.newPage())

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 60_000 })

  if (PHASE === 'warm') {
    // clientsClaim is false on purpose — a worker never seizes a page that is
    // already running, so the first load installs it and the next is the one
    // it controls. That posture is what the update rule rests on.
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 60_000 })
    const controlled = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 500))
      return !!navigator.serviceWorker.controller
    })
    check('the service worker is controlling the page on production', controlled)

    const running = await runningBuild(page)
    const served = await servedBuild(page)
    check('the running bundle reports a build id', !!running, String(running))
    check('and production is serving that same build', running === served?.buildNumber, JSON.stringify(served))

    const noUpdate = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      await reg.update()
      await new Promise((r) => setTimeout(r, 5_000))
      return { waiting: !!reg.waiting, installing: !!reg.installing }
    })
    check('NO update is found while production has not moved', !noUpdate.waiting && !noUpdate.installing, JSON.stringify(noUpdate))

    writeFileSync(STATE, JSON.stringify({ base: BASE, warmedAt: new Date().toISOString(), build: running }, null, 2))
    console.log(`\n  warmed on ${running}. Land a deploy, wait for /version.json to move, then run PHASE=apply.`)
  } else {
    const state = JSON.parse(readFileSync(STATE, 'utf8'))
    const before = await runningBuild(page)
    const served = await servedBuild(page)
    check('the shell opened on the build it was warmed on', before === state.build, `${before} (warmed on ${state.build})`)
    check('production has genuinely moved on since then', !!served?.buildNumber && served.buildNumber !== state.build, JSON.stringify(served))
    check('so the page is running OLD code — an update did not seize it', before !== served?.buildNumber)

    const waiting = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      await reg.update()
      for (let i = 0; i < 120 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 500))
      return { waiting: !!reg.waiting, stillControlledByOld: !!navigator.serviceWorker.controller }
    })
    check('a NEW service worker installed and is WAITING', waiting.waiting)
    check('it did NOT take over the live page by itself', waiting.stillControlledByOld)
    check('and the page is STILL the old code until it is applied', (await runningBuild(page)) === state.build)

    // The page may relaunch itself the moment the new worker activates — that
    // is the app's own doing and it destroys this execution context.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
      await new Promise((r) => setTimeout(r, 1500))
    }).catch((e) => console.log(`  (the page relaunched under us: ${String(e).split('\n')[0]})`))
    await page.waitForTimeout(2_000)
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.locator('.mode-trigger').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})

    const after = await runningBuild(page)
    check('after applying, the page IS the new code', after === served?.buildNumber, `${state.build} -> ${after}`)
  }
} finally {
  await ctx.close()
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
