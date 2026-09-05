/**
 * Hit-test, not eyeball: a padlock on the wrong chip and a padlock on the right
 * chip look identical on a nine-chip strip. Asserts WHICH chips carry the lock
 * element, which carry the dashed/unfilled waiting class, that neither is
 * disabled, and screenshots both states at a phone viewport.
 */
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
const out = process.env.SHOT_DIR || path.join(here, 'shots')
fs.mkdirSync(out, { recursive: true })

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  const f = path.join(dist, url === '/' ? 'index.html' : url)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(4319, r))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const results = {}

const readStrip = () => page.evaluate(() => {
  const chips = [...document.querySelectorAll('.map-chip')].filter((c) => !c.classList.contains('map-chip--infplay'))
  return chips.map((c) => {
    const cs = getComputedStyle(c)
    return {
      label: c.getAttribute('aria-label'),
      lock: !!c.querySelector('.map-chip-lock'),
      downloadArrow: !!c.querySelector('.map-chip-dl'),
      waitingClass: c.classList.contains('is-offline'),
      disabled: c.hasAttribute('disabled'),
      borderStyle: cs.borderTopStyle,
      background: cs.backgroundColor,
      opacity: cs.opacity,
    }
  })
})

for (const state of ['paywalled', 'awaiting', 'both']) {
  await page.goto(`http://localhost:4319/?state=${state}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.map-chip')
  results[state] = await readStrip()
  await page.screenshot({ path: path.join(out, `belt-strip-${state}.png`), fullPage: false })
  const strip = await page.$('.map-row-wrap')
  if (strip) await strip.screenshot({ path: path.join(out, `belt-strip-${state}-closeup.png`) })
}

// A padlocked chip must still emit its jump — that tap is what opens the paywall.
await page.goto('http://localhost:4319/?state=paywalled', { waitUntil: 'networkidle' })
const locked = await page.$('.map-chip:has(.map-chip-lock)')
const lockedDisabled = await locked.evaluate((el) => el.hasAttribute('disabled'))
await locked.click()
results.padlockedChipTappable = !lockedDisabled

await browser.close()
server.close()
fs.writeFileSync(path.join(out, 'hit-test.json'), JSON.stringify(results, null, 2))

// --- assertions -----------------------------------------------------------
const fails = []
const belts = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Black']
const free = new Set(['White', 'Yellow'])

results.paywalled.forEach((c, i) => {
  const b = belts[i]
  const wantLock = !free.has(b)
  if (c.lock !== wantLock) fails.push(`paywalled: ${b} lock=${c.lock}, expected ${wantLock}`)
  if (c.disabled) fails.push(`paywalled: ${b} is disabled — navigation is never refused`)
})
results.awaiting.forEach((c, i) => {
  const b = belts[i]
  const waiting = ['Green', 'Blue', 'Purple', 'Brown', 'Black'].includes(b)
  if (c.lock) fails.push(`awaiting: ${b} wears a PADLOCK for a download — the whole bug`)
  if (c.waitingClass !== waiting) fails.push(`awaiting: ${b} waitingClass=${c.waitingClass}, expected ${waiting}`)
  if (c.downloadArrow !== waiting) fails.push(`awaiting: ${b} arrow=${c.downloadArrow}, expected ${waiting}`)
  if (c.disabled) fails.push(`awaiting: ${b} is disabled — navigation is never refused`)
  if (waiting) {
    if (c.borderStyle !== 'dashed') fails.push(`awaiting: ${b} border is ${c.borderStyle}, expected dashed`)
    if (c.background !== 'rgba(0, 0, 0, 0)') fails.push(`awaiting: ${b} has a fill (${c.background})`)
    if (Number(c.opacity) >= 1) fails.push(`awaiting: ${b} is not dimmed (${c.opacity})`)
  }
})
results.both.forEach((c, i) => {
  const b = belts[i]
  if (['Orange'].includes(b) && !c.lock) fails.push('both: Orange (unpaid, downloaded) lost its padlock')
  if (['Green', 'Blue', 'Purple', 'Brown', 'Black'].includes(b)) {
    if (!c.lock) fails.push(`both: ${b} is unpaid AND undownloaded — entitlement wins, expected a padlock`)
    if (c.downloadArrow) fails.push(`both: ${b} shows two glyphs at once`)
  }
})
if (!results.padlockedChipTappable) fails.push('a padlocked chip was disabled — the tap must reach the paywall')

console.log(JSON.stringify(results, null, 2))
if (fails.length) { console.error('\nFAILED:\n' + fails.join('\n')); process.exit(1) }
console.log('\nAll belt-strip hit-tests passed. Shots in ' + out)
