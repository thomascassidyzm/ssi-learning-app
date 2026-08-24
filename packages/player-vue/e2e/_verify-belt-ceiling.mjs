// Live check: a white-belt EASY learner's listening clips never exceed 0.8x
// (x the course globalSpeed). Measures playbackRate ACTUALLY SET on the audio
// element at play() time — ground truth for what the learner hears.
import { chromium } from '@playwright/test'

const BASE = process.env.PROBE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app/'
const COURSE = process.env.PROBE_COURSE || 'spa_for_eng'
const SECONDS = Number(process.env.PROBE_SECONDS || 300)
const MODE = process.env.PROBE_MODE || 'easy'

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))

// Mark the windows during which a LISTENING lap is sounding.
const lapWindows = []
page.on('console', (m) => {
  const t = m.text()
  if (/podScheduler|layer1Scheduler|playPodLap|pod lap|L1 lap/i.test(t)) {
    lapWindows.push({ t: Date.now(), text: t.slice(0, 160) })
  }
})

await page.addInitScript(() => {
  window.__rates = []
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    try {
      const src = this.currentSrc || this.src || ''
      if (src && !src.startsWith('data:audio/wav')) {
        // Attribute a clip to a LISTENING lap by DOM, not by console log —
        // the deployed build STRIPS console.log, so log-based correlation
        // silently measures nothing (learned from listening-belt-speed-probe).
        // .pod-listening-ambient is the marker that covers BOTH layers — it is
        // rendered on `playingPodLapAudio`, which is set for Layer-1 seed cups
        // as well as Layer-2 pods. .pod-turn-display alone MISSES Layer 1
        // entirely, because Layer-1 plays are audio-only with no display text
        // by product rule (2026-07-22). A 15-minute Layer-1 run measured zero
        // listening clips before this was widened.
        const lap = !!document.querySelector('.pod-listening-ambient')
          || !!document.querySelector('.pod-turn-display')
          || !!document.querySelector('.listening-overlay')
        window.__rates.push({ t: Date.now(), src: src.slice(-44), rate: this.playbackRate, lap })
      }
    } catch {}
    return origPlay.apply(this, a)
  }
})
await page.addInitScript(({ m, c }) => {
  try {
    localStorage.setItem('ssi-last-course', c)
    localStorage.setItem('ssi-learning-mode', m)
  } catch {}
}, { m: MODE, c: COURSE })

const u = new URL(BASE)
u.searchParams.set('course', COURSE)
// ?podview=1 is the INSTANT pod preview cheat (dev/staging only): the play tap
// goes straight into a listening pod lap. ?pod=1 alone still waits out the
// ~5 main rounds of pod activation, which a short probe never reaches — a run
// with it measured 32 SPEAKING clips and zero listening ones.
u.searchParams.set('podview', '1')
// Extra cheats, e.g. PROBE_PARAMS=l1test=1,l1=1 — the ?l1test 2-cup wheel makes
// a Layer-1 seed recur every 2 main rounds instead of every 30, so its EXPOSURE
// count climbs fast enough to reach the ramp's 1.0 step inside a probe run.
// That is the only live route to an AGED phrase as a fresh guest: ageing a
// Layer-2 cohort needs ~45 min of real cadence or a signed-in learner carrying
// learner_pod_state rows.
for (const kv of (process.env.PROBE_PARAMS || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('='); u.searchParams.set(k, v ?? '1')
}
if (process.env.PROBE_NO_PODVIEW) u.searchParams.delete('podview')
await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('.center-btn', { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(3000)
const resting = page.locator('.player-resting-state button, .resting-cta').first()
if (await resting.count()) await resting.click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(1000)
await page.locator('.bottom-nav .center-btn').first().click({ timeout: 8000 }).catch(() => {})

const deadline = Date.now() + SECONDS * 1000
let shot = 0
while (Date.now() < deadline) {
  await page.waitForTimeout(10000)
  // Keep clicking any play affordance that appears — onboarding, a resume
  // card or a course chooser can sit between load and actual playback.
  for (const sel of ['.center-btn', '.play-button', 'button[aria-label*="lay"]']) {
    const el = page.locator(sel).first()
    if (await el.count()) { await el.click({ timeout: 2500 }).catch(() => {}); break }
  }
  // A "New version available" service-worker prompt can steal the screen on a
  // long run; dismiss it rather than let it end the session early.
  for (const label of ['Later', 'Dismiss']) {
    const b = page.getByRole('button', { name: label }).first()
    if (await b.count()) { await b.click({ timeout: 2000 }).catch(() => {}); break }
  }
  if (shot === 0) { await page.screenshot({ path: process.env.PROBE_SHOT || '/home/tomcassidy/.tmp/belt-probe.png' }).catch(() => {}); shot = 1 }
}
const onScreen = await page.evaluate(() => ({
  url: location.href,
  buttons: [...document.querySelectorAll('button')].slice(0, 12).map(b => (b.textContent || '').trim().slice(0, 30)),
  hasPodDisplay: !!document.querySelector('.pod-turn-display'),
  bodyText: (document.body.innerText || '').slice(0, 300),
}))

const rates = await page.evaluate(() => window.__rates || [])
const mode = await page.evaluate(() => { try { return localStorage.getItem('ssi-learning-mode') } catch { return null } })
await browser.close()

const counts = {}
for (const r of rates) counts[r.rate] = (counts[r.rate] || 0) + 1
const max = rates.length ? Math.max(...rates.map(r => r.rate)) : null
console.log(JSON.stringify({
  mode, modeConfirmed: mode, course: COURSE, clips: rates.length,
  distinctRates: counts, maxRate: max,
  lapSignals: lapWindows.length,
  listeningClips: rates.filter(r => r.lap).length,
  listeningRates: rates.filter(r => r.lap).reduce((a, r) => { a[r.rate] = (a[r.rate] || 0) + 1; return a }, {}),
  onScreen,
  sample: rates.slice(0, 24),
  // Listening rates in time order — this is what shows the ramp climbing (or
  // being held at the belt ceiling) across a phrase's successive exposures.
  listeningTimeline: rates.filter(r => r.lap).map(r => r.rate),
  jsErrors: errs.slice(0, 3),
}, null, 2))
