// MODE-TRAY OUTSIDE-TAP PROBE — Tom reported ~10 times that once the mode tray
// is open, the only way to close it is the trigger button again. This drives a
// REAL browser against a REAL build and proves the tap-anywhere-outside dismiss,
// because unit tests could never have caught the actual cause: the backdrop's
// `position: fixed; inset: 0` resolves against .bottom-nav's transform, so the
// "full-screen" backdrop was only ever the size of the nav pill.
//
//   BASE_URL=http://localhost:4173 CHROME_BIN=<chromium> \
//     node e2e/mode-tray-outside-tap-probe.mjs
//
// Prints the backdrop's real measured geometry (the evidence for the diagnosis)
// and PASS/FAIL per assertion; exits 1 on any fail.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const COURSE = process.env.COURSE || 'spa_for_eng'
const OUT = process.env.OUT_DIR || '/tmp/mode-tray/'
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch(
  process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}
)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.addInitScript((course) => {
  try { localStorage.setItem('ssi-last-course', course) } catch { /* storage blocked */ }
}, COURSE)

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(3000)

// The tray only renders on the player screen (isOnPlayerScreen), so start play.
await page.locator('.center-btn').first().click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(6000)

const trigger = page.locator('.mode-trigger').first()
check('mode trigger is on screen', (await trigger.count()) > 0)
if (!(await trigger.count())) { await page.screenshot({ path: `${OUT}no-trigger.png` }); process.exit(1) }

const trayOpen = async () => (await page.locator('.mode-tray').count()) > 0
const openTray = async () => {
  if (!(await trayOpen())) await trigger.click({ timeout: 5000 })
  await page.waitForTimeout(400)
}

// ── The diagnosis, measured ────────────────────────────────────────────────
await openTray()
check('tray opens on the trigger', await trayOpen())
await page.screenshot({ path: `${OUT}1-open.png` })

const geom = await page.evaluate(() => {
  const bd = document.querySelector('.tray-backdrop')
  const r = bd?.getBoundingClientRect()
  return {
    backdrop: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } : null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    // What actually receives a tap in the middle of the screen?
    atCentre: (() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      return el ? `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}` : null
    })(),
  }
})
console.log('[geometry]', JSON.stringify(geom))
console.log(
  geom.backdrop && geom.backdrop.h < geom.viewport.h * 0.5
    ? '[note] backdrop is NOT full-viewport (transformed containing block) — which is why it could never be the dismiss'
    : '[note] backdrop covers most of the viewport'
)

// ── The behaviour Tom asked for ────────────────────────────────────────────
// A tap in the dead centre of the screen — nowhere near the tray or the nav.
await page.mouse.click(geom.viewport.w / 2, geom.viewport.h / 2)
await page.waitForTimeout(500)
check('tap in the middle of the screen closes the tray', !(await trayOpen()))
await page.screenshot({ path: `${OUT}2-after-centre-tap.png` })

// A tap high up, near the top of the screen.
await openTray()
await page.mouse.click(geom.viewport.w / 2, 90)
await page.waitForTimeout(500)
check('tap near the top of the screen closes the tray', !(await trayOpen()))

// A tap just outside the tray but inside the nav row — the old backdrop's turf.
await openTray()
await page.mouse.click(30, geom.viewport.h - 40)
await page.waitForTimeout(500)
check('tap in the nav row outside the tray closes the tray', !(await trayOpen()))

// The trigger still toggles — no close-then-immediately-reopen race.
await openTray()
await trigger.click({ timeout: 5000 })
await page.waitForTimeout(500)
check('the trigger still closes the tray (no reopen race)', !(await trayOpen()))

// …and it reopens straight afterwards (the click-swallow must not eat this).
await trigger.click({ timeout: 5000 })
await page.waitForTimeout(500)
check('tray reopens immediately after being closed', await trayOpen())

// REGRESSION GUARD for 1c41b1d2: rows inside the tray must still be tappable —
// that fix existed because a teleported backdrop painted over them.
await openTray()
const rows = page.locator('.mode-tray .tray-item')
const rowCount = await rows.count()
check('tray rows are present', rowCount > 0, `${rowCount} rows`)
const blocked = await page.evaluate(() => {
  const row = document.querySelector('.mode-tray .tray-item')
  if (!row) return 'no row'
  const r = row.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit && row.contains(hit) ? null : `intercepted by ${hit?.className || hit?.tagName}`
})
check('nothing intercepts a tap on a tray row', blocked === null, blocked || 'clean')
await page.screenshot({ path: `${OUT}3-rows.png` })

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED')
await ctx.close()
await browser.close()
process.exit(failures ? 1 : 0)
