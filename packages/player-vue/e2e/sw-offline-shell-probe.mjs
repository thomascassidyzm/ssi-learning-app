// SW OFFLINE SHELL PROBE — offline cold start of the BUILT app. Serve from
// `vite preview`, let the SW install, then flip the context offline (airplane
// mode: navigator.onLine === false, which is what gates the boot watchdog)
// AND kill the server, then reload. The precached shell must come back from
// the service worker and the app must reach mount without healing.
//   node e2e/sw-offline-shell-probe.mjs
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const PORT = 4199
const BASE = `http://localhost:${PORT}`

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
})
await new Promise((r) => setTimeout(r, 2500))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined })
const ctx = await browser.newContext()
const page = await ctx.newPage()

await page.goto(BASE + '/', { waitUntil: 'load' })
// A second load: with clientsClaim false everywhere (2026-08-07 — no worker
// may claim a live page, see docs/pwa-lifecycle-design.md §2.1a) the first
// visit installs the SW but is never controlled by it. Every returning visit
// is, which is the state this probe is about.
await page.evaluate(() => navigator.serviceWorker.ready)
await page.reload({ waitUntil: 'load' })
// Wait until the SW is activated AND controlling.
const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready
  for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100))
  const keys = await caches.keys()
  const pre = keys.find((k) => k.includes('precache'))
  const n = pre ? (await (await caches.open(pre)).keys()).length : 0
  return { active: reg.active?.state, controller: !!navigator.serviceWorker.controller, precached: n }
})
console.log('SW:', JSON.stringify(swReady))
check('SW controls page with precache', swReady.controller && swReady.precached > 0, JSON.stringify(swReady))

// Airplane mode: navigator.onLine goes false (gates the boot watchdog) and
// the server dies too — nothing can be fetched.
await ctx.setOffline(true)
server.kill('SIGKILL')
await new Promise((r) => setTimeout(r, 1000))

await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => console.log('reload error:', e.message))
await page.waitForTimeout(6000)
const body = (await page.textContent('body').catch(() => '')) || ''
const title = await page.title().catch(() => '')
const isErrorPage = /ERR_|No internet|not connected/i.test(body) || title === ''
check('shell loads offline', body.length > 0 && !isErrorPage, `title="${title}" body=${body.length} chars`)
const booted = await page.evaluate(() => window.__SSI_BOOTED === true).catch(() => false)
check('app mounts offline (no heal)', booted)
await page.screenshot({ path: '/tmp/sw-offline-shell.png' })

await browser.close()
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
