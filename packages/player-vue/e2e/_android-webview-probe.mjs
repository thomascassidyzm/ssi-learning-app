/**
 * Emulate the Capacitor Android WebView exactly: page origin https://localhost,
 * every https://localhost/* request served from the BUILT android assets
 * (which is what Capacitor's shouldInterceptRequest does), everything else
 * going to the real network. Then make a real authenticated /api call from
 * inside the page and see what comes back.
 */
import { chromium } from '@playwright/test'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ASSETS = process.argv[2]
const TOKEN = readFileSync(process.argv[3], 'utf8').trim()
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2',
  '.webmanifest':'application/manifest+json', '.ico':'image/x-icon', '.jpg':'image/jpeg', '.webp':'image/webp' }

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
const apiCalls = []
await ctx.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.origin === 'https://localhost') {
    let p = join(ASSETS, decodeURIComponent(url.pathname))
    if (url.pathname === '/' || (existsSync(p) && statSync(p).isDirectory())) p = join(ASSETS, 'index.html')
    if (!existsSync(p)) return route.fulfill({ status: 404, body: 'not in assets' })
    return route.fulfill({ status: 200, contentType: TYPES[extname(p)] || 'application/octet-stream', body: readFileSync(p) })
  }
  return route.continue()
})
const page = await ctx.newPage()
page.on('request', r => { if (r.url().includes('/api/')) apiCalls.push(r.url()) })

await page.goto('https://localhost/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

const seam = await page.evaluate(() => ({
  origin: location.origin,
  injected: window.__SSI_PLATFORM__,
  fetchWrapped: !!fetch.__ssiApiOriginRewrite,
}))

const result = await page.evaluate(async (token) => {
  // A LITERAL app-relative path, exactly as the 402 call sites in this app
  // write it. Nothing here knows about an API origin.
  const res = await fetch('/api/me/profile', { headers: { Authorization: 'Bearer ' + token } })
  const body = await res.text()
  return {
    requestedPath: '/api/me/profile',
    finalUrl: res.url,
    status: res.status,
    acao: res.headers.get('access-control-allow-origin'),
    vary: res.headers.get('vary'),
    bodyHead: body.slice(0, 220),
  }
}, TOKEN)

console.log(JSON.stringify({ seam, result, apiCallsSeenOnBoot: apiCalls.slice(0, 12) }, null, 2))
await page.screenshot({ path: process.argv[4] || '/tmp/webview.png', fullPage: false })
await browser.close()
