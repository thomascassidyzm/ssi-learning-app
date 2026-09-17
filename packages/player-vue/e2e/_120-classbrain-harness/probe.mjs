/**
 * Before/after shots of the Course journey card on a 300-chunk class, at a
 * phone viewport — the card inline and the full-screen overlay, plus the
 * overlay's own way out still working under the fold.
 *
 * Run: npx vite build -c vite.config.ts && node probe.mjs
 */
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
const tag = process.env.SHOT_TAG || 'after'
const out = process.env.SHOT_DIR || path.join(here, 'shots')
fs.mkdirSync(out, { recursive: true })

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  const f = path.join(dist, url === '/' ? 'index.html' : url)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(4327, r))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const results = {}

for (const mode of (process.env.MODES || 'truncated,full').split(',')) {
  const fixture = process.env.FIXTURE || 'synthetic'
  await page.goto(`http://localhost:4327/?mode=${mode}&fixture=${fixture}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cb-draw svg')
  results[mode] = await page.evaluate(() => ({
    dots: document.querySelectorAll('.cb-draw circle').length,
    arcs: document.querySelectorAll('.cb-draw path.cb-arc, .cb-draw path').length,
    cloth: document.querySelectorAll('.cb-cloth').length,
    tiles: [...document.querySelectorAll('.cb-stat-value')].map((e) => e.textContent.trim()),
  }))
  await page.screenshot({ path: path.join(out, `${tag}-${mode}-card.png`), fullPage: false })
  // The replay transport, open, mid-scrub.
  await page.click('.cb-btn')
  const range = await page.$('.cb-transport input[type=range]')
  await range.evaluate((el) => { el.value = String(Math.round(Number(el.max) * 0.62)); el.dispatchEvent(new Event('input')) })
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(out, `${tag}-${mode}-replay.png`), fullPage: false })
  // The full-screen overlay.
  await page.click('.cb-btn-icon')
  await page.waitForSelector('.cb-full')
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(out, `${tag}-${mode}-full.png`), fullPage: false })
  results[mode].closeVisible = await page.isVisible('[data-testid=cb-close]')
  await page.click('[data-testid=cb-close]')
  await page.waitForTimeout(150)
  results[mode].closed = !(await page.$('.cb-full'))
}

await browser.close()
server.close()
fs.writeFileSync(path.join(out, `${tag}-probe.json`), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
console.log('shots in ' + out)
