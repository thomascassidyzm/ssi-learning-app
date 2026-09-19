// Job #256 — repro for the S0006L01_intro "starts then dies" failure.
//
// Hypothesis under test: the clip does not fail because of the file, the SW or
// the device. It fails because a bare, never-drained `fetch(url)` is issued for
// the SAME url the <audio> element is loading at that moment. In the intro of a
// LEGO with no presentation narration the prompt falls back to the known clip,
// so the NEXT cycle (the debut) has an identical known url — and
// SimplePlayer.prefetchNextCycle fires `void fetch(sameUrl, {priority:'high'})`
// while the prompt is still loading.
//
//   node e2e/_256-intro-audio-repro.mjs            (staging)
//   PROBE_ORIGIN=https://saysomethingin.app node ...
//
// Each arm runs in a FRESH context (cold HTTP cache) so the first load of the
// url is the one under test. Prints one JSON line per arm.
import { chromium } from '@playwright/test'

const ORIGIN = process.env.PROBE_ORIGIN || 'https://staging.saysomethingin.app'
// cym_s_for_eng S0006L01 — known clip ("I can't"), the intro prompt fallback.
const KNOWN = process.env.PROBE_AUDIO || 'ec452a39-6b9d-4cae-a914-38c82900ccdc'
const URL_ = `${ORIGIN}/api/audio/${KNOWN}`

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
})

async function arm(name, mode) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  // A blank same-origin document: we want the audio path, not the SPA.
  await page.route('**/probe-blank', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>probe</body></html>' }))
  await page.goto(`${ORIGIN}/probe-blank`, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(async ({ url, mode }) => {
    const log = []
    const a = new Audio()
    let err = null
    a.addEventListener('error', () => {
      const e = a.error
      err = { code: e?.code, message: e?.message, at: Math.round(performance.now()), currentTime: a.currentTime }
    })
    const done = new Promise((res) => {
      a.addEventListener('ended', () => res('ended'))
      a.addEventListener('error', () => res('error'))
      setTimeout(() => res('timeout'), 8000)
    })
    const bare = () => { try { void fetch(url).catch(() => {}) } catch {} }
    const drained = async () => { try { await (await fetch(url)).arrayBuffer() } catch {} }

    if (mode === 'drain-first') await drained()
    const t0 = performance.now()
    if (mode === 'fetch-before') bare()
    a.src = url
    try { await a.play(); log.push(`play() resolved at ${Math.round(performance.now() - t0)}ms`) }
    catch (e) { log.push('play() rejected: ' + String(e).slice(0, 80)) }
    if (mode === 'fetch-during') bare()
    if (mode === 'fetch-after-50') setTimeout(bare, 50)
    const outcome = await done
    return { outcome, err, playedTo: a.currentTime, duration: a.duration, log }
  }, { url: URL_, mode })
  await ctx.close()
  console.log(JSON.stringify({ arm: name, mode, ...result }))
  return result
}

const arms = [
  ['control: play alone', 'none'],
  ['bare fetch immediately BEFORE play', 'fetch-before'],
  ['bare fetch immediately AFTER play()', 'fetch-during'],
  ['bare fetch 50ms after play', 'fetch-after-50'],
  ['drained fetch first, then play', 'drain-first'],
]
for (const [name, mode] of arms) await arm(name, mode)
await browser.close()
