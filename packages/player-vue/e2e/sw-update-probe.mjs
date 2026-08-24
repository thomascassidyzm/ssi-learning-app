// SW UPDATE PROBE — the real old→new update path, end to end.
//
// Two prod-mode builds are made outside this script (different build numbers,
// in /tmp/pwa-old and /tmp/pwa-new — see docs/pwa-update-crash-2026-08-07.md).
// A tiny static server serves ONE directory whose contents we swap mid-run:
// exactly what a Vercel deploy does to a running client — the old hashed
// chunks stop existing on the origin.
//
//   node e2e/sw-update-probe.mjs [old-dir] [new-dir]
//
// Scenarios:
//   S1  background install while the page runs   → new SW must WAIT, page unharmed
//   S2  update taken, reload suppressed          → the iOS "reload didn't take" case:
//                                                  can the still-running page still
//                                                  load its own code?
//   S3  update taken normally                    → lands booted on the new build
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

const OLD = process.argv[2] || '/tmp/pwa-old'
const NEW = process.argv[3] || '/tmp/pwa-new'
const PORT = Number(process.env.PROBE_PORT || 4207)
const BASE = `http://localhost:${PORT}`

let serveDir = OLD
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`)
  if (!ok) failures++
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE)
  let path = decodeURIComponent(url.pathname)
  if (path.endsWith('/')) path += 'index.html'
  let file = join(serveDir, path)
  let ok = await stat(file).then((s) => s.isFile()).catch(() => false)
  if (!ok) {
    // Asset-shaped requests must 404 like a real deploy does — only bare
    // navigations fall back to the SPA shell.
    if (extname(path)) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      return res.end('not found')
    }
    file = join(serveDir, 'index.html')
    ok = await stat(file).then((s) => s.isFile()).catch(() => false)
    if (!ok) { res.writeHead(404); return res.end() }
    path = '/index.html'
  }
  const body = await readFile(file)
  const type = MIME[extname(path)] || 'application/octet-stream'
  const noStore = path === '/index.html' || path === '/version.json' || path === '/sw.js'
  res.writeHead(200, {
    'content-type': type,
    'cache-control': noStore ? 'no-store' : 'public, max-age=31536000, immutable',
  })
  res.end(body)
})
await new Promise((r) => server.listen(PORT, r))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined })

/** Boot a fresh profile on the OLD build, SW installed AND controlling. */
async function bootControlledOnOld() {
  serveDir = OLD
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const log = { pageErrors: [], notFound: [], consoleErrors: [] }
  page.on('pageerror', (e) => log.pageErrors.push(String(e.message).slice(0, 200)))
  page.on('response', (r) => { if (r.status() === 404) log.notFound.push(r.url().replace(BASE, '')) })
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 160)) })
  page.on('crash', () => log.pageErrors.push('PAGE CRASHED'))

  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Second load: the SW controls the page — the state every returning user is
  // in, and the only state in which an update can interrupt a live session.
  await page.reload({ waitUntil: 'load' })
  const st = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100))
    return { controller: !!navigator.serviceWorker.controller, booted: window.__SSI_BOOTED === true }
  })
  return { ctx, page, log, st }
}

/** The URLs of the entry-graph chunks this page is running. */
const entryChunks = (page) => page.evaluate(() =>
  [...document.querySelectorAll('script[type=module][src], link[rel=modulepreload][href]')]
    .map((e) => e.src || e.href).filter((u) => u.endsWith('.js')))

/** Can the running page still fetch the code it may lazily need? */
const canLoadOwnChunks = (page, urls) => page.evaluate(async (list) => {
  const out = []
  for (const u of list) {
    try {
      const r = await fetch(u)
      out.push({ u: new URL(u).pathname, status: r.status })
    } catch (e) { out.push({ u: new URL(u).pathname, status: 'throw:' + e.message }) }
  }
  return out
}, urls)

// =============================================================== S1 + S3
{
  console.log('\n=== S1: background install while the page runs ===')
  const { ctx, page, log, st } = await bootControlledOnOld()
  check('old build installs, controls the page, boots', st.controller && st.booted, JSON.stringify(st))

  const mine = await entryChunks(page)
  serveDir = NEW
  console.log(`deployed new build; ${mine.length} entry chunks belong to the running page`)
  const errsBefore = log.pageErrors.length

  await page.evaluate(async () => { (await navigator.serviceWorker.getRegistration()).update() })
  await page.waitForTimeout(9000)

  const s1 = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return {
      waiting: reg.waiting?.state || null,
      active: reg.active?.state || null,
      booted: window.__SSI_BOOTED === true,
      body: (document.body.innerText || '').slice(0, 100).replace(/\n/g, ' | '),
    }
  })
  console.log('state:', JSON.stringify(s1))
  check('new SW waits — does not claim the live page', s1.waiting === 'installed', JSON.stringify(s1))
  check('live page unharmed by the background install',
    log.pageErrors.length === errsBefore && s1.booted, JSON.stringify(log.pageErrors.slice(errsBefore)))
  check('no heal/floor screen', !/Updating the app|needs a fix|Update ready/.test(s1.body), s1.body)
  const beforeSwap = await canLoadOwnChunks(page, mine)
  check('page can still load its own chunks while the new SW waits',
    beforeSwap.every((r) => r.status === 200), JSON.stringify(beforeSwap))

  console.log('\n=== S2: user taps Update ===')
  const nav = page.waitForNavigation({ timeout: 25000 }).catch(() => null)
  await page.getByRole('button', { name: 'Update' }).click()
  await nav
  await page.waitForTimeout(6000)
  const s2 = await page.evaluate(() => ({
    booted: window.__SSI_BOOTED === true,
    body: (document.body.innerText || '').slice(0, 100).replace(/\n/g, ' | '),
  }))
  const live = await page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.buildNumber))
  const running = await entryChunks(page)
  console.log('after update:', JSON.stringify(s2), 'live build:', live)
  check('lands booted after taking the update', s2.booted, JSON.stringify(s2))
  check('no heal/floor screen after the update', !/Updating the app|needs a fix|Update ready/.test(s2.body), s2.body)
  // Chunks whose content didn't change keep their hash across builds, so the
  // signal is the ENTRY module: the document itself must be the new one.
  const entryOf = (urls) => urls.find((u) => /\/assets\/index-/.test(u))
  check('running the NEW build after the update',
    !!entryOf(running) && entryOf(running) !== entryOf(mine),
    JSON.stringify({ was: entryOf(mine), now: entryOf(running) }))
  check('the update banner is gone (running build === live build)',
    !/New version available/.test(s2.body), s2.body)

  // The invariant that makes the "crashes halfway through updating" class
  // impossible: taking an update must not delete anything from under anyone.
  // A worker that stays waiting has not touched the precache, so even a client
  // that failed to navigate still has every chunk it was running.
  console.log('\n=== S3: nothing was destroyed on the way ===')
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return { waiting: reg.waiting?.state || null, active: reg.active?.state || null }
  })
  const oldStillThere = await canLoadOwnChunks(page, mine)
  console.log('sw:', JSON.stringify(sw))
  check('the new worker is STILL waiting — never activated under a live page',
    sw.waiting === 'installed', JSON.stringify(sw))
  check('the previous build\'s chunks are all still served',
    oldStillThere.every((r) => r.status === 200),
    JSON.stringify(oldStillThere.filter((r) => r.status !== 200)))
  console.log('404s:', JSON.stringify([...new Set(log.notFound)].slice(0, 10)))
  console.log('page errors:', JSON.stringify(log.pageErrors.slice(0, 5)))
  await ctx.close()
}

await browser.close()
server.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
