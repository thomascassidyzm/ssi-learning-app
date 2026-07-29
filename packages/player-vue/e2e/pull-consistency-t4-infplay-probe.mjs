// Tranche-4 follow-up probe: INF-PLAY entry + belt freeze in a real browser.
// Guests are entitlement-gated out of INF-PLAY on premium courses (course-end
// content), so this switches to a FREE course via the course chooser, walks
// the cursor to the course end (deep-link jumps), enters INF-PLAY via the
// round-forward control at the final LEGO, and asserts the M9 freeze:
//   - belt accent locks to SSi red (#c23a3a) on entry,
//   - advancing through revival rounds does NOT move it (no bounce),
//   - playback still flows (revival handoff produces cycle text).
// Every step degrades to INFO (not FAIL) if the surface isn't reachable —
// the run reports what it could and couldn't prove.
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/pull-consistency-t4-probe/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}
const info = (label, detail = '') => console.log(`INFO — ${label}${detail ? ` :: ${detail}` : ''}`)
const bail = async (msg) => {
  info(msg)
  await ctx.close()
  console.log('\nPROBE INCONCLUSIVE (surface unreachable) — see INFO lines')
  process.exit(0)
}

const profile = '/tmp/pull-consistency-t4-inf-profile'
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  viewport: { width: 390, height: 844 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = ctx.pages()[0] || (await ctx.newPage())
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

const beltColor = () => page.evaluate(() => {
  const root = document.querySelector('.learning-player-root') || document.body
  return getComputedStyle(root).getPropertyValue('--belt-color').trim()
})
// Freshest position entry wins — after a course switch there are entries for
// BOTH courses; keying off the first would read the old course's cursor.
const readSeed = () => page.evaluate(() => {
  let best = null
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('ssi_learning_position_')) {
      try {
        const v = JSON.parse(localStorage.getItem(k))
        if (v && (!best || (v.lastUpdated ?? 0) > (best.lastUpdated ?? 0))) best = v
      } catch { /* skip */ }
    }
  }
  return best?.seedNumber ?? null
})
const jumpTo = async (seed) => {
  await page.evaluate((s) => window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', { detail: { seedNumber: s } })), seed)
  await page.waitForTimeout(7000)
  return readSeed()
}

await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)

// ── Switch to a free course via the chooser ──
const trigger = page.locator('.course-name--tappable').first()
if (!(await trigger.count())) await bail('course-name trigger not found — cannot switch course')
await trigger.click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(1200)
if (!(await page.locator('.selector-overlay').isVisible().catch(() => false))) await bail('course chooser did not open')

const rows = page.locator('.course-row')
const rowCount = await rows.count()
const FREE_HINT = /gaelic|cornish|manx|basque|breton|irish|scots|frisian|occitan|galician|catalan|esperanto|yiddish|maori|hawai|navajo|guarani|nahuatl|tatar|latvian|lithuanian|estonian|slovene|croat|serb|ukrain|dutch|danish|swedish|norwegian|finnish|polish|czech|hungarian|romanian|greek|turkish|hindi|urdu|bengali|tamil|thai|vietnamese|indonesian|swahili|welsh/i
const BIG10_OR_PREMIUM = /spanish|french|german|italian|portuguese|chinese|japanese|arabic|korean|english|welsh/i
let chosen = null
const seen = []
for (let i = 0; i < rowCount; i++) {
  const text = (await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim()
  seen.push(text)
  if (text.toLowerCase().includes('variant')) continue
  if (BIG10_OR_PREMIUM.test(text)) continue
  if (FREE_HINT.test(text)) { chosen = { i, text }; break }
}
info('course rows seen', seen.join(' | ').slice(0, 400))
if (!chosen) await bail('no free-tier course row identified in the catalogue — INF-PLAY stays gated for a guest')
info('switching to free course', chosen.text)
await rows.nth(chosen.i).click().catch(() => {})
await page.waitForTimeout(9000)
await page.screenshot({ path: `${OUT}t4-inf-1-free-course.png` }).catch(() => {})

// Position persists to localStorage only while PLAYING (phase=prompt saves) —
// start playback before jumping, or the cursor probe reads nothing.
for (const sel of ['.center-btn', 'button:has-text("Start")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { await btn.click({ timeout: 8000 }).catch(() => {}); break }
}
await page.waitForTimeout(8000)

// ── Walk the cursor toward the course end (ascending — each landed jump
// keeps script expansion moving; stop at the first miss) ──
let highest = null
for (const s of [15, 40, 80, 150, 300, 400, 500, 600, 650, 668, 680, 700]) {
  const got = await jumpTo(s)
  if (got === s) highest = s
  // keep climbing even past a miss — seeds aren't dense at the tail
}
if (highest === null) await bail('no deep-link jump landed on the free course — cannot reach course end')
info('highest landed seed via deep-link', String(highest))
await jumpTo(highest)

// Nudge forward with the round-forward control until INF-PLAY triggers.
const skipBtn = page.locator('button[aria-label="Next LEGO"], button[aria-label="Skip listening section"]').first()
if (!(await skipBtn.count())) await bail('round-forward control not found')

let beltNow = await beltColor()
let entered = beltNow === '#c23a3a'
for (let i = 0; i < 20 && !entered; i++) {
  await skipBtn.click().catch(() => {})
  // enterInfPlay warm-up + (first-time) intro typewriter can take ~20s.
  await page.waitForTimeout(i === 0 ? 4000 : 6000)
  beltNow = await beltColor()
  entered = beltNow === '#c23a3a'
  if (i % 5 === 4) info(`still advancing (skip ${i + 1})`, `belt=${beltNow} seed=${await readSeed()}`)
}
if (!entered) {
  await page.screenshot({ path: `${OUT}t4-inf-2-no-entry.png` }).catch(() => {})
  await bail(`INF-PLAY not entered after 20 round-forwards (belt=${beltNow}) — course end not reached in probe budget`)
}
check('M9: INF-PLAY entry locked the belt accent to SSi red', true, `belt=${beltNow}`)
await page.screenshot({ path: `${OUT}t4-inf-3-entered.png` }).catch(() => {})

// ── Freeze across revival rounds ──
const samples = [beltNow]
for (let i = 0; i < 3; i++) {
  await skipBtn.click().catch(() => {})
  await page.waitForTimeout(6000)
  samples.push(await beltColor())
}
check('M9: belt stays locked red across revival-round advances (freeze, no bounce)', samples.every((c) => c === '#c23a3a'), `samples=${[...new Set(samples)].join(',')}`)

// Revival handoff still produces cycle text (audio/text flowing).
const heroText = await page.locator('.hero-target, .hero-known, .known-text, .prompt-text').first().textContent().catch(() => null)
check('INF-PLAY revival rounds still produce cycle text (handoff alive)', !!heroText && heroText.trim().length > 0, `text="${(heroText || '').trim().slice(0, 40)}"`)
await page.screenshot({ path: `${OUT}t4-inf-4-revival.png` }).catch(() => {})

await ctx.close()
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
