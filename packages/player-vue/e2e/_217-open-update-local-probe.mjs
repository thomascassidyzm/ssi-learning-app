// #217 local probe — the on-open update screen, against a real production
// build of the app, in a real browser, with a real service worker.
//
// It reproduces the ONE situation the gate exists for, with nothing faked in
// the app at all: the document the learner is running is build A (served from
// the worker's precache, or simply from a shell that has not rotated yet)
// while `/version.json` — the deployment's own answer — says build B is live.
// The only thing this harness does is BE that deployment: it serves the real
// built `dist/` and, on command, starts answering `/version.json` with a newer
// build id and time, exactly as Vercel does the moment a deploy lands.
//
// What it asserts, in order:
//   1. nothing paints while the build ids agree — no update, no UI;
//   2. the instant a newer build is live, the next open SAYS SO on screen, in
//      the app's own copy, before anything reloads;
//   3. the reload happens after the screen has been up, not under the learner;
//   4. a second open that still cannot reach the new build does NOT hold and
//      does NOT reload again — the anti-loop rule, which is the one that turns
//      a wedge into a boot loop if it is wrong.
//
// Run: node e2e/_217-open-update-local-probe.mjs   (needs a built dist/)
import { chromium } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = path.resolve('dist')
const OUT = process.env.OUT || '/home/tomcassidy/.tmpbig/probe-217-local'
fs.mkdirSync(OUT, { recursive: true })
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('FAIL: no dist/ — run `pnpm --filter player-vue build` first')
  process.exit(1)
}

const real = JSON.parse(fs.readFileSync(path.join(DIST, 'version.json'), 'utf8'))
// The "deployment" answers with this. Flipping it IS the deploy.
let live = { ...real }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/version.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end(JSON.stringify(live))
  }
  let file = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(4319, r))
const BASE = 'http://localhost:4319'
console.log('serving the real build', real.buildNumber, 'at', BASE)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const ctx = await browser.newContext({ serviceWorkers: 'allow' })
const page = await ctx.newPage()
const fails = []
const ok = (cond, what) => { console.log(cond ? '  ✓' : '  ✗', what); if (!cond) fails.push(what) }

// ── 1. no update, no UI ─────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(8000)
await page.evaluate(() => navigator.serviceWorker.ready)
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(5000)
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
console.log('service worker controls the page:', controlled)
ok(controlled, 'the service worker controls the page, as it does on a returning learner\'s phone')
ok(await page.locator('.ssi-open-update').count() === 0, 'nothing paints while the running build IS the live build')
await page.screenshot({ path: `${OUT}/1-no-update-no-ui.png` })

// ── 2/3. a deploy lands; the next open says so, then reloads ────────────────
live = { buildNumber: 'deadbee', buildTime: new Date(Date.parse(real.buildTime) + 3600_000).toISOString(), buildBranch: real.buildBranch }
console.log('deploy: /version.json now answers', live.buildNumber)

// Every main-frame navigation, with its time — the one that matters is the
// one AFTER the screen went up. The reopen's own commit lands first and must
// not be mistaken for it.
const navAt = []
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navAt.push(Date.now()) })
const openedAt = Date.now()
await page.reload({ waitUntil: 'commit' })

await page.waitForSelector('.ssi-open-update', { timeout: 20000, state: 'visible' })
const shownAt = Date.now()
await page.screenshot({ path: `${OUT}/2-update-screen.png` })
const text = (await page.locator('.ssi-open-update-card').innerText()).replace(/\n/g, ' / ')
console.log('UPDATE SCREEN:', JSON.stringify(text))
ok(/updating/i.test(text), 'the screen says the app is updating, in the app\'s own copy')
ok(await page.locator('.ssi-open-update').evaluate((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().height > 300),
  'it covers the screen, so no tap lands on a document about to be replaced')

// The reload must come AFTER the screen, not under the learner.
await page.waitForTimeout(4000)
const afterScreen = navAt.filter((t) => t > shownAt)
ok(afterScreen.length > 0, `the reload fired AFTER the screen was up (screen +${shownAt - openedAt}ms, reload +${afterScreen[0] ? afterScreen[0] - openedAt : '—'}ms)`)

// ── 4. the anti-loop rule ───────────────────────────────────────────────────
// The reload landed on the same build — the deployment still says `deadbee` is
// live and this shell cannot become it. A second hold here would be a boot
// loop, which is worse than being one build behind.
await page.waitForTimeout(6000)
const held = await page.locator('.ssi-open-update').count()
const quietFrom = Date.now()
await page.waitForTimeout(8000)
const navs = navAt.filter((t) => t > quietFrom)
ok(held === 0, 'the second open does NOT hold the screen again for a build it already tried')
ok(navs.length === 0, 'and does NOT reload again — no boot loop')
await page.screenshot({ path: `${OUT}/3-no-loop.png` })

await browser.close()
server.close()
console.log(fails.length ? `FAIL (${fails.length}):\n - ${fails.join('\n - ')}` : 'PASS — every assertion held')
process.exit(fails.length ? 1 : 0)
