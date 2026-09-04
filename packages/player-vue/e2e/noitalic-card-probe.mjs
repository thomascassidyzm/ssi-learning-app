// Before/after evidence probe for the synthetic-italic fix (2026-09-04).
// Evidence capture for the italic-gloss-on-non-italic-scripts fix. Change no
// code — this file just drives the LIVE staging site and records what the
// known-language line under the target phrase looks like RIGHT NOW, before
// the CSS fix lands.
//
// Surface: ListeningOverlay.vue "pods" view (default view) — the current
// phrase row renders `.phrase-target` (top) then `.phrase-known` (the
// italic-styled gloss line underneath). This is the surface Tom saw the
// slanted Tamil/CJK glyphs on.
//
// node e2e/_noitalic-before.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/cs-11267ab1-ef90-4d35-b333-6f58c44f701e/before/'
mkdirSync(OUT, { recursive: true })

const COURSES = (process.env.COURSES || 'zho_for_tam,eng_for_kor,spa_for_eng').split(',')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
})

const results = {}

for (const course of COURSES) {
  const steps = []
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))

  try {
    // Step 1: reset + load with course selected via URL param.
    steps.push(`goto ${BASE}/?course=${course}&reset=1`)
    await page.goto(`${BASE}/?course=${course}&reset=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)

    steps.push(`goto ${BASE}/?course=${course}`)
    await page.goto(`${BASE}/?course=${course}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)

    // Step 2: enter the player (guest entry / start / continue).
    for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
      const b = page.locator(sel).first()
      if (await b.count()) {
        try {
          await b.click({ timeout: 8000 })
          steps.push(`click ${sel}`)
          break
        } catch { /* try next */ }
      }
    }
    await page.waitForTimeout(4000)

    // Step 3: open the mode tray.
    const trigger = page.locator('.mode-trigger').first()
    await trigger.waitFor({ state: 'visible', timeout: 15000 })
    await trigger.click()
    steps.push('click .mode-trigger')
    await page.waitForTimeout(500)

    // Step 4: click the Listening-mode tray item — matched by its icon SVG
    // path (language-independent; the tray label text is locale-translated).
    const listeningItem = page.locator(
      'button.tray-item:has(path[d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"])'
    ).first()
    await listeningItem.waitFor({ state: 'visible', timeout: 8000 })
    await listeningItem.click()
    steps.push('click button.tray-item[listening icon]')
    await page.waitForTimeout(4000)

    // Step 5: confirm the listening overlay is open. Default view is a scene
    // list ("pods") — click "Play all scenes" to enter playback and get a
    // current phrase row rendered.
    await page.locator('.listening-overlay').first().waitFor({ state: 'visible', timeout: 10000 })
    steps.push('wait .listening-overlay visible')

    const playAll = page.locator('.scene-play-all').first()
    if (await playAll.count()) {
      await playAll.click()
      steps.push('click .scene-play-all')
      await page.waitForTimeout(3000)
    }

    const knownSel = '.phrase-row.current .phrase-known, .phrase-pair .phrase-known'
    const targetSel = '.phrase-row.current .phrase-target, .phrase-pair .phrase-target'
    await page.locator(knownSel).first().waitFor({ state: 'visible', timeout: 15000 })
    steps.push(`wait ${knownSel} visible`)

    // Give one playback cycle to settle so the "current" row is stable.
    await page.waitForTimeout(2000)

    const dom = await page.evaluate(({ knownSel, targetSel }) => {
      const readEl = (el) => {
        if (!el) return null
        const cs = getComputedStyle(el)
        return {
          text: (el.textContent || '').trim(),
          lang: el.getAttribute('lang'),
          fontStyle: cs.fontStyle,
          fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily,
          color: cs.color,
          className: el.className,
        }
      }
      const known = document.querySelector(knownSel)
      const target = document.querySelector(targetSel)
      return { known: readEl(known), target: readEl(target) }
    }, { knownSel, targetSel })

    const shotPath = `${OUT}${course}.png`
    // Zoom on the current phrase row for a legible crop.
    const rowLocator = page.locator('.phrase-row.current, .phrase-pair').first()
    if (await rowLocator.count()) {
      await rowLocator.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      await rowLocator.screenshot({ path: shotPath }).catch(async () => {
        await page.screenshot({ path: shotPath })
      })
    } else {
      await page.screenshot({ path: shotPath })
    }
    steps.push(`screenshot -> ${shotPath}`)

    results[course] = { ok: true, screenshot: shotPath, steps, dom, pageErrors: pageErrors.slice(0, 5) }
  } catch (err) {
    const shotPath = `${OUT}${course}-FAILURE.png`
    await page.screenshot({ path: shotPath }).catch(() => {})
    results[course] = {
      ok: false,
      error: String(err).slice(0, 500),
      steps,
      screenshot: shotPath,
      pageErrors: pageErrors.slice(0, 5),
    }
  } finally {
    await ctx.close()
  }
}

writeFileSync(`${OUT}report.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
await browser.close()
