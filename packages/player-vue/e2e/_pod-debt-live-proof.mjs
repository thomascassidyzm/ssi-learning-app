// Live proof for #649 — the 5-round WORK DEBT delivers a pod dialogue.
// Phone size (420x860). Plays a real guest session on the dev alias and
// watches for a genuine pod dialogue (pod_lap_start with isLayer1 === false)
// plus the .pod-turn-display DOM it renders. Nothing is forced: no ?pod=1,
// no cheats beyond ?reset=1 (clean state) and ?stream (bypass cache play).
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'

const URL = process.env.PROBE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app/?reset=1&stream'
const OUT = process.env.PROBE_OUT
const BUDGET_MS = Number(process.env.PROBE_BUDGET_MS || 2_700_000) // 45 min
mkdirSync(OUT, { recursive: true })

const events = []
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()

page.on('request', (req) => {
  if (!req.url().includes('/api/player-events')) return
  try {
    const body = JSON.parse(req.postData() || '{}')
    const rows = Array.isArray(body) ? body : (body.events || [body])
    for (const r of rows) events.push(r)
  } catch { /* ignore */ }
})
const logs = []
page.on('console', (m) => {
  const t = m.text()
  if (/pod|debt|round/i.test(t)) logs.push(`${new Date().toISOString()} ${t.slice(0, 300)}`)
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForTimeout(9000)
const clicked = await page.evaluate(() => {
  const play = document.querySelector('button.center-btn')
  if (play && !play.disabled) { play.click(); return 'center-btn' }
  return null
})
console.log('CLICKED=' + clicked)

const deadline = Date.now() + BUDGET_MS
let podShot = false
while (Date.now() < deadline) {
  await page.waitForTimeout(5000)
  const dom = await page.evaluate(() => ({
    hasPodTurn: !!document.querySelector('.pod-turn-display'),
    roundLabel: document.body.innerText.slice(0, 200),
  }))
  const roundCompletes = events.filter((e) => (e.event_type || e.event) === 'round_complete').length
  const podLaps = events.filter((e) => {
    const t = e.event_type || e.event
    if (t !== 'pod_lap_start') return false
    const p = e.payload || e
    return p.isLayer1 === false
  })
  if (dom.hasPodTurn && !podShot) {
    podShot = true
    await page.screenshot({ path: `${OUT}/pod-dialogue-on-screen.png` })
    console.log(`POD DIALOGUE ON SCREEN after ${roundCompletes} round_complete events`)
  }
  if (podLaps.length >= 1 && podShot) {
    console.log(`PROVEN: ${podLaps.length} pod dialogue lap(s), ${roundCompletes} rounds completed`)
    break
  }
  if (Date.now() % 60_000 < 5000) console.log(`... rounds=${roundCompletes} podLaps=${podLaps.length} podDom=${dom.hasPodTurn}`)
}

const roundCompletes = events.filter((e) => (e.event_type || e.event) === 'round_complete').length
const podLaps = events.filter((e) => {
  const t = e.event_type || e.event
  if (t !== 'pod_lap_start') return false
  const p = e.payload || e
  return p.isLayer1 === false
})
writeFileSync(`${OUT}/events.json`, JSON.stringify(events, null, 2))
writeFileSync(`${OUT}/console.log`, logs.join('\n'))
await page.screenshot({ path: `${OUT}/final.png`, fullPage: true })
console.log(`RESULT rounds_completed=${roundCompletes} pod_dialogue_laps=${podLaps.length} pod_dom_seen=${podShot}`)
await browser.close()
process.exit(podShot && podLaps.length >= 1 ? 0 : 1)
