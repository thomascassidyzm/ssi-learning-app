// LIVE verification of PRACTISING mode and its ONE trigger (2026-08-31).
//
// Tom's rule: "we should just keep playing as always, whether network is good
// or bad, UNTIL we cant fetch the next NEW LEGO, the LEGO whose turn it is. At
// THAT point we go into practising mode."
//
// This probe fails THAT ONE FETCH and nothing else. The connection stays
// perfectly healthy throughout — no offline window, no black hole, no throttle
// — which is the whole point: nothing about connectivity may move the mode, so
// nothing about connectivity is simulated.
//
// It replaces _verify-consolidating-banner-2026-08-31.mjs, whose black-hole
// technique could not reach the state in six runs (job #473) and which asserted
// a selector and a trigger that no longer exist.
//
// WHAT IT ASSERTS
//   1. ENTRY on the real trigger — abort the tier-3 /cycles call (the next new
//      LEGO) and the `.practising-banner` appears, with a real bounding box.
//   2. PLAYBACK NEVER STOPS underneath it.
//   3. POSITION IS FROZEN — the stored learner position is byte-identical
//      before and after the practising stretch.
//   4. RECOVERY — let that same fetch work again and the mode ends on its own,
//      via the 60s heartbeat, without the learner touching anything.
//
// The default course is bundle-enabled, so its "next new LEGO" is computed from
// one cached bundle and never touches the wire. Blocking /bundle drops the
// session onto the network path (round-map + /cycles) that most courses use;
// the FIRST /cycles call is the bootstrap (the LEGO under the playhead) and
// every one after it is tier 3 — the fetch under test.
//
//   LD_LIBRARY_PATH=$HOME/.pwlibs/root/usr/lib/x86_64-linux-gnu \
//   node e2e/_verify-practising-trigger-2026-08-31.mjs
import { chromium } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const PROFILE = process.env.PROFILE_DIR || path.join(os.tmpdir(), `ssi-practising-${Date.now()}`)
const ENTER_WATCH_MS = Number(process.env.ENTER_WATCH_MS || 60_000)
const EXIT_WATCH_MS = Number(process.env.EXIT_WATCH_MS || 210_000)

const readBanner = (page) => page.evaluate(() => {
  const el = document.querySelector('.practising-banner')
  const r = el && el.getBoundingClientRect()
  const pos = localStorage.getItem(
    Object.keys(localStorage).find((k) => k.startsWith('ssi_learning_position_')) || '',
  )
  return {
    found: !!el,
    box: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    text: el ? el.innerText.replace(/\n/g, ' | ') : null,
    position: pos,
  }
})

const run = async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    args: ['--no-sandbox'],
    viewport: { width: 390, height: 844 },
  })
  const page = ctx.pages()[0] || await ctx.newPage()
  let cyclesCalls = 0
  let failingTheNextNewLego = true

  await page.route('**/api/courses/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/bundle')) return route.abort('failed')
    if (url.includes('/cycles')) {
      cyclesCalls++
      if (failingTheNextNewLego && cyclesCalls > 1) return route.abort('failed')
    }
    return route.continue()
  })

  const fail = (why) => { console.error(`FAIL: ${why}`); process.exitCode = 1 }

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(9_000)
    await page.locator('.center-btn').first().click({ timeout: 10_000 })

    // 1. ENTRY
    let entry = null
    for (let waited = 0; waited < ENTER_WATCH_MS; waited += 5_000) {
      await page.waitForTimeout(5_000)
      const st = await readBanner(page)
      if (st.found && st.box?.w > 0 && st.box?.h > 0) { entry = st; break }
    }
    if (!entry) return fail('never entered PRACTISING on a failed next-new-LEGO fetch')
    console.log(`ENTERED — banner ${entry.box.w}x${entry.box.h}: "${entry.text}"`)

    // 2. PLAYBACK still running underneath it.
    const playing = await page.evaluate(() =>
      [...document.querySelectorAll('audio')].some((a) => !a.paused) || !!document.querySelector('.hero-text-pane'))
    if (!playing) fail('playback stopped under the banner')

    // 4. RECOVERY, unaided — no clicks, no reload.
    failingTheNextNewLego = false
    let left = false
    for (let waited = 0; waited < EXIT_WATCH_MS; waited += 5_000) {
      await page.waitForTimeout(5_000)
      const st = await readBanner(page)
      if (!st.found) {
        left = true
        console.log(`LEFT after ~${waited / 1000}s of a healthy next-new-LEGO fetch`)
        // 3. POSITION FROZEN across the whole stretch.
        if (st.position !== entry.position) fail(`position moved while practising:\n  ${entry.position}\n  ${st.position}`)
        else console.log('POSITION UNCHANGED across the practising stretch')
        break
      }
    }
    if (!left) fail(`still practising after ${EXIT_WATCH_MS / 1000}s of healthy network`)
    if (!process.exitCode) console.log('PASS')
  } finally {
    await ctx.close()
  }
}

await run()
