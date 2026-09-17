// Job #117 load-time probe. Measures cold + repeat load of the learner home and a
// class Overview as a REAL signed-in ZZ Test Chepstow teacher, phone width, throttled 4G.
// Reports requests, bytes transferred (encoded) and time-to-interactive-ish per page.
import { chromium } from '/home/tomcassidy/.cs-worktrees/ssi-learning-app/117-ssi-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.mjs'
import fs from 'node:fs'

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const TAG = process.env.TAG || 'before'
const CLASS_ID = 'ea59ef42-ab29-46d0-a956-a4fdbe5e1d09'
const EMAIL = 'thomas.cassidy+chepstowtest-cover@gmail.com'

const env = Object.fromEntries(fs.readFileSync('/home/tomcassidy/SSi/ssi-learning-app/.env.local', 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')]))
const SB_URL = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const SERVICE = fs.readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env', 'utf8')
  .split('\n').find(l => l.startsWith('SUPABASE_SERVICE_KEY=')).split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '')
const REF = new URL(SB_URL).hostname.split('.')[0]

async function mintSession() {
  const gl = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  }).then(r => r.json())
  const otp = gl.email_otp || gl.properties?.email_otp
  if (!otp) throw new Error('no otp: ' + JSON.stringify(gl).slice(0, 300))
  const v = await fetch(`${SB_URL}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL, token: otp }),
  }).then(r => r.json())
  if (!v.access_token) throw new Error('no session: ' + JSON.stringify(v).slice(0, 300))
  return v
}

const FOURG = { offline: false, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8, latency: 70 }

async function measure(page, cdp, url, label, out) {
  const byId = new Map()
  const done = []
  const onResp = (e) => byId.set(e.requestId, { url: e.response.url, status: e.response.status,
    fromDisk: !!e.response.fromDiskCache, fromSW: !!e.response.fromServiceWorker, mime: e.response.mimeType })
  const onFin = (e) => { const r = byId.get(e.requestId); if (r) done.push({ ...r, bytes: e.encodedDataLength || 0 }) }
  cdp.on('Network.responseReceived', onResp)
  cdp.on('Network.loadingFinished', onFin)
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load', timeout: 90000 })
  const tLoad = Date.now() - t0
  // "interactive": real content on screen, not a spinner
  try { await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 40, null, { timeout: 45000 }) } catch {}
  const tContent = Date.now() - t0
  await page.waitForTimeout(3000)
  cdp.off('Network.responseReceived', onResp)
  cdp.off('Network.loadingFinished', onFin)
  const net = done.filter(r => !r.fromSW && !r.fromDisk)
  out.push({ label, url,
    requests: done.length,
    fromNetwork: net.length,
    fromSW: done.filter(r => r.fromSW).length,
    fromDiskCache: done.filter(r => r.fromDisk).length,
    kbOverWire: Math.round(done.reduce((a, b) => a + b.bytes, 0) / 1024),
    loadMs: tLoad, contentMs: tContent,
    top: net.map(r => [r.url.replace(/^https?:\/\/[^/]+/, ''), r.bytes]).sort((a,b)=>b[1]-a[1]).slice(0,6) })
}

const rows = []
const browser = await chromium.launch({
  executablePath: '/home/tomcassidy/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
})
const session = await mintSession()
async function newCtx() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  await ctx.addInitScript(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)) }, [`sb-${REF}-auth-token`, session])
  return ctx
}

for (const [name, path] of [['learner home', '/'], ['class overview', `/org/${CLASS_ID}`]]) {
  const ctx = await newCtx()
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', FOURG)
  await measure(page, cdp, BASE + path, `${name} COLD`, rows)
  // let the SW install/precache settle, then repeat-visit in the SAME context
  await page.waitForTimeout(4000)
  await measure(page, cdp, BASE + path, `${name} REPEAT`, rows)
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify({ tag: TAG, base: BASE, rows }, null, 2))
