// PLAYER SMOKE — learner home loads, a lesson starts, audio actually plays.
// Guest context, phone viewport. Run against any deployment:
//   BASE_URL=https://staging.saysomethingin.app node e2e/player-smoke.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = process.env.OUT_DIR || '/tmp/player-smoke/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  window.__audioPlays = []
  const orig = Audio.prototype.play
  Audio.prototype.play = function (...a) { window.__audioPlays.push(this.src || '(nosrc)'); return orig.apply(this, a) }
})

const t0 = Date.now()
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
const loadMs = Date.now() - t0
const body = (await page.textContent('body').catch(() => '')) || ''
check('learner home loads', body.length > 200, `${loadMs}ms — ${page.url()}`)
check('no streak language', !/streak/i.test(body))
await page.screenshot({ path: `${OUT}1-home.png` })

const startBtn = page.locator('button:has-text("Start"), button:has-text("Continue"), button:has-text("Play"), [class*="play-button"], [aria-label*="play" i]').first()
let clicked = false
try { await startBtn.click({ timeout: 8000 }); clicked = true } catch { /* fallthrough */ }
check('lesson start control found + clicked', clicked)
await page.waitForTimeout(9000)
await page.screenshot({ path: `${OUT}2-playing.png` })
const plays = await page.evaluate(() => window.__audioPlays.length).catch(() => 0)
check('audio plays', plays > 0, `${plays} Audio.play() calls`)
const errReal = errors.filter((e) => !/favicon|manifest/.test(e))
check('zero page errors', errReal.length === 0, errReal.slice(0, 3).join(' | '))

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
