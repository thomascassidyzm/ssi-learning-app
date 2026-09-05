/**
 * ANDROID BOTTOM-CONTROL CLEARANCE — hit-test, not screenshot.
 *
 * Deborah, first external Android tester, 2026-09-05: "I do not like that the
 * bottom controls are so close to my phone controls." This proves the fix:
 * at three simulated system-bar insets, EVERY control in the bottom row (and
 * the mode-tray trigger floating above it) is (a) hit-testable at its own
 * centre via elementFromPoint, and (b) entirely above the line where the
 * system navigation bar starts, by at least the stated touch margin.
 *
 * A screenshot cannot show either. This estate has already shipped a dropdown
 * with zero tappable pixels that photographed perfectly.
 *
 * The three insets:
 *   0px  — Capacitor has padded the WebView out of the system bars, so it
 *          reports nothing. The floor alone must carry the clearance.
 *   24px — a typical gesture-navigation inset.
 *   48px — three-button navigation, the tall case.
 *
 * Run: node e2e/_android-clearance-harness/probe.mjs
 */
import { chromium } from '@playwright/test'
import { build } from 'vite'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
const out = process.env.SHOT_DIR || path.join(here, 'shots')
fs.mkdirSync(out, { recursive: true })

// The touch margin the Android rule promises between the chrome and the bar.
const TOUCH_MARGIN = 16
// The floor used when an inset source IS reporting (platform/shellSafeArea.ts).
const FLOOR_MEASURED = 24

await build({ configFile: path.join(here, 'vite.config.ts') })

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  const f = path.join(dist, url === '/' ? 'index.html' : url)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
// Ephemeral port: sibling workers share this box and fixed ports collide.
await new Promise((r) => server.listen(0, r))
const base = `http://localhost:${server.address().port}`

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
// Pixel 7 viewport — the same device Playwright's `android` project uses.
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })

// Every control the learner taps down here. `.mode-trigger` is the tray button
// that floats above the row; it inherits the row's clearance by construction
// (position: absolute; bottom: calc(100% + 12px)) and is asserted anyway.
// The row's five buttons in DOM order, plus the tray trigger. Indexed rather
// than class-selected: every button in the row shares .pill-btn except the
// centre one, so :nth-of-type() silently picks the wrong control.
const ROW_ORDER = ['grid', 'previous', 'play', 'next', 'settings']
const EXTRA = [{ name: 'modes', sel: '.mode-trigger' }]

const failures = []
const report = []

for (const inset of ['0px', '24px', '48px']) {
  await page.goto(`${base}/?inset=${encodeURIComponent(inset)}`)
  await page.waitForSelector('.bottom-nav')
  await page.waitForTimeout(150)

  const insetPx = parseFloat(inset)
  const result = await page.evaluate(({ rowOrder, extra, insetPx }) => {
    const controls = [
      ...rowOrder.map((name, i) => ({ name, el: document.querySelectorAll('.nav-content > button')[i] })),
      ...extra.map(({ name, sel }) => ({ name, el: document.querySelector(sel) })),
    ]
    const vh = window.innerHeight
    // The line at which the system navigation bar starts, in page coordinates.
    const barTop = vh - insetPx
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect()
    return {
      viewportHeight: vh,
      barTop,
      navBottom: nav.bottom,
      clearance: barTop - nav.bottom,
      resolvedClearance: getComputedStyle(document.documentElement)
        .getPropertyValue('--shell-nav-clearance').trim(),
      controls: controls.map(({ name, el }) => {
        if (!el) return { name, missing: true }
        const r = el.getBoundingClientRect()
        const cx = Math.round(r.left + r.width / 2)
        const cy = Math.round(r.top + r.height / 2)
        const hit = document.elementFromPoint(cx, cy)
        return {
          name,
          cx, cy,
          bottom: r.bottom,
          clearance: barTop - r.bottom,
          // The control itself, or something inside it (its own <span>/<svg>),
          // counts as a hit. Anything else is an overlay eating the tap.
          hitsSelf: !!hit && (el === hit || el.contains(hit)),
          hitTag: hit ? `${hit.tagName.toLowerCase()}.${hit.className?.baseVal ?? hit.className}` : null,
        }
      }),
    }
  }, { rowOrder: ROW_ORDER, extra: EXTRA, insetPx })

  // The Android rule floats the row max(inset + 16, floor 24) above the bottom
  // of the viewport, so the gap ABOVE the system bar is that minus the inset.
  const expected = Math.max(insetPx + TOUCH_MARGIN, FLOOR_MEASURED) - insetPx

  for (const c of result.controls) {
    if (c.missing) { failures.push(`inset ${inset}: control "${c.name}" not rendered`); continue }
    if (!c.hitsSelf) failures.push(`inset ${inset}: "${c.name}" centre (${c.cx},${c.cy}) hits ${c.hitTag}, not itself`)
    if (c.clearance < TOUCH_MARGIN - 0.5) {
      failures.push(`inset ${inset}: "${c.name}" bottom edge clears the nav bar by only ${c.clearance.toFixed(1)}px (need ≥ ${TOUCH_MARGIN})`)
    }
  }
  if (result.clearance < expected - 0.5) {
    failures.push(`inset ${inset}: row clears the bar by ${result.clearance.toFixed(1)}px, expected ≥ ${expected}`)
  }

  report.push({ inset, expected, ...result })
  await page.screenshot({ path: path.join(out, `clearance-${insetPx}.png`) })
}

// Control: with the Android rule OFF (web / iOS), the old geometry is intact —
// 12px minimum, half the inset. This is what proves the fix did not move iOS.
await page.goto(`${base}/?android=0&inset=48px`)
await page.waitForSelector('.bottom-nav')
const web = await page.evaluate(() => {
  const nav = document.querySelector('.bottom-nav').getBoundingClientRect()
  return { fromBottom: window.innerHeight - nav.bottom }
})
if (Math.abs(web.fromBottom - 24) > 0.5) {
  failures.push(`web/iOS control: expected half of a 48px inset = 24px, got ${web.fromBottom.toFixed(1)}px`)
}
report.push({ mode: 'web/iOS (android rule off), inset 48px', fromBottom: web.fromBottom })

// NEGATIVE CONTROL. The same assertions against the PRE-FIX rule must FAIL —
// half a 48px three-button inset leaves the row 24px up, i.e. inside the bar.
// A probe that has only ever been seen green proves nothing.
await page.goto(`${base}/?legacy=1&inset=48px`)
await page.waitForSelector('.bottom-nav')
const legacy = await page.evaluate(() => {
  const nav = document.querySelector('.bottom-nav').getBoundingClientRect()
  return { fromBottom: window.innerHeight - nav.bottom }
})
const legacyClearsBar = legacy.fromBottom - 48
if (legacyClearsBar >= TOUCH_MARGIN) {
  failures.push(`negative control: the OLD rule also cleared the bar by ${legacyClearsBar.toFixed(1)}px — the probe cannot tell the fix from the bug`)
}
report.push({ mode: 'NEGATIVE CONTROL — old rule, 48px inset', fromBottom: legacy.fromBottom, clearsBarBy: legacyClearsBar })

fs.writeFileSync(path.join(out, 'clearance-report.json'), JSON.stringify({ failures, report }, null, 2))
console.log(JSON.stringify({ failures, report }, null, 2))

await browser.close()
server.close()

if (failures.length) {
  console.error(`\n✗ ${failures.length} clearance failure(s)`)
  process.exit(1)
}
console.log('\n✓ every bottom control hit-testable and clear of the nav bar at 0 / 24 / 48px insets')
