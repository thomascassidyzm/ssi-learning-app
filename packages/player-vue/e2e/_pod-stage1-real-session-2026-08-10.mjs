// Live probe — Stage 1 explainer repeat cancelled (Tom 2026-08-10).
// Watches consecutive pod laps on the dev alias and records, per lap:
// the play roles, their stages, their speeds, and the DOM state.
// Method copied from docs/pod-lap-probe-2026-08-10 (job #61), re-run.
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const URL = process.env.PROBE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app/?reset=1&stream'
const OUT = process.env.PROBE_OUT || '/home/tomcassidy/wt-pod-stage1/.probe-out-real'
mkdirSync(OUT, { recursive: true })

const events = []
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const page = await ctx.newPage()

page.on('request', (req) => {
  if (!req.url().includes('/api/player-events')) return
  try {
    const body = JSON.parse(req.postData() || '{}')
    const rows = Array.isArray(body) ? body : (body.events || [body])
    for (const r of rows) events.push(r)
  } catch { /* ignore */ }
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForTimeout(8000)

// The centre play button is `.center-btn` (no text, no aria-label).
const clicked = await page.evaluate(() => {
  const play = document.querySelector('button.center-btn')
  if (play && !play.disabled) { play.click(); return 'center-btn' }
  return null
})
console.log('CLICKED=' + clicked)
await page.waitForTimeout(3000)

const domSnaps = []
const deadline = Date.now() + 500_000
let lapsSeen = 0
while (Date.now() < deadline) {
  await page.waitForTimeout(4000)
  const dom = await page.evaluate(() => ({
    t: new Date().toISOString(),
    hasPodTurn: !!document.querySelector('.pod-turn-display'),
    hasLegoAssembly: !!document.querySelector('[class*="lego-assembly"]'),
  }))
  domSnaps.push(dom)
  lapsSeen = events.filter(e => e.event_type === 'pod_lap_start' || e.event === 'pod_lap_start').length
  if (lapsSeen >= 6) break
}

writeFileSync(`${OUT}/events.json`, JSON.stringify(events, null, 2))
writeFileSync(`${OUT}/dom.json`, JSON.stringify(domSnaps, null, 2))
await page.screenshot({ path: `${OUT}/final.png`, fullPage: true })

// Human-readable sequence
const lines = []
for (const e of events) {
  const type = e.event_type || e.event
  const p = e.payload || e
  if (type === 'pod_lap_start') lines.push(`--- pod_lap_start podRound=${p.podRound} plays=${p.plays}`)
  else if (type === 'pod_lap_end') lines.push(`--- pod_lap_end`)
  else if (type === 'audio_play') lines.push(`    role=${p.role} stage=${p.stage} sentenceIdx=${p.sentenceIdx} speed=${p.playbackSpeed}`)
}
writeFileSync(`${OUT}/sequence.txt`, lines.join('\n'))
console.log(lines.join('\n'))
console.log('\nLAPS=' + lapsSeen)
console.log('EXPLAINER_COUNT=' + events.filter(e => JSON.stringify(e).includes('"explainer"')).length)
console.log('DOM=' + JSON.stringify(domSnaps.slice(0, 6)))
await browser.close()
